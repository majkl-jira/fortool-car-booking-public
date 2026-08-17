import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  format, parseISO, isToday, isBefore, isSameDay,
  startOfMonth, endOfMonth, eachDayOfInterval, getDay,
  addMonths, subMonths, startOfDay, addDays,
} from 'date-fns';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import Wordmark from '../components/Wordmark';
import RulesModal from '../components/RulesModal';

// ── design tokens — tenká vrstva nad CSS proměnnými z @theme (src/index.css) ──
// Zdroj pravdy pro hodnoty je @theme blok; tady jen mapování pro inline styly.
const T = {
  ink:     'var(--color-ink)',
  signal:  'var(--color-signal)',
  free:    'var(--color-success)',       // zelená (dostupnost, potvrzení)
  base:    'var(--color-base)',
  field:   'var(--color-field)',
  line:    'var(--color-line)',
  ink50:   'var(--color-ink-50)',
  ink30:   'var(--color-ink-30)',
  gold:    'var(--color-warn)',          // "moje" rezervace (oranžová do redesignu kalendáře)
  danger:  'var(--color-danger)',
  sg:      'var(--font-sg)',
  inter:   'var(--font-sg)',             // Inter vyřazen — sjednoceno na Space Grotesk
  mono:    'var(--font-mono)',           // IBM Plex Mono
  manrope: 'var(--font-sg)',             // Manrope vyřazen — sjednoceno na Space Grotesk
};

// ── month names ──────────────────────────────────────────────────────────────
const CS_MONTHS = [
  'Leden','Únor','Březen','Duben','Květen','Červen',
  'Červenec','Srpen','Září','Říjen','Listopad','Prosinec',
];
const CS_MONTHS_GEN = [
  'ledna','února','března','dubna','května','června',
  'července','srpna','září','října','listopadu','prosince',
];
const CS_DAYS_SHORT = ['po','út','st','čt','pá','so','ne'];
const CS_DAYS_FULL  = ['pondělí','úterý','středa','čtvrtek','pátek','sobota','neděle'];

// Interval pollingu (real-time aktualizace bez WebSocketů); /vehicles,
// pendingCount a verze pravidel se přinačítají každý 6. tick (1×/min).
const POLL_MS = 10000;

// Strop délky rezervace — musí sedět se serverem (MAX_BOOKING_DAYS
// v bookingController.js), ať klient nepustí něco, co server odmítne.
const MAX_BOOKING_DAYS = 30;

function fmtDayHeading(day) {
  const idx = (getDay(day) + 6) % 7;
  return `${CS_DAYS_FULL[idx]} ${day.getDate()}. ${CS_MONTHS_GEN[day.getMonth()]} ${day.getFullYear()}`;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function buildDate(year, month, day, hour, minute) {
  if (!year || !month || !day) return null;
  return new Date(+year, +month - 1, +day, +hour || 0, +minute || 0, 0, 0);
}

function buildISO(year, month, day, hour, minute) {
  const d = buildDate(year, month, day, hour, minute);
  return d ? d.toISOString() : null;
}

function fmtTime(d) {
  const dt = (d instanceof Date) ? d : new Date(d);
  return `${dt.getHours()}:${String(dt.getMinutes()).padStart(2, '0')}`;
}
function fmtRange(from, to) {
  const fd = new Date(from), td = new Date(to);
  if (isSameDay(fd, td)) {
    return `${format(fd, 'dd.MM')}  ${fmtTime(fd)} → ${fmtTime(td)}`;
  }
  return `${format(fd, 'dd.MM')} ${fmtTime(fd)} → ${format(td, 'dd.MM')} ${fmtTime(td)}`;
}
function fmtShort(iso) {
  const d = new Date(iso);
  return `${format(d, 'dd.MM')} ${fmtTime(d)}`;
}

// Formát pro knihu rezervací: „PÁ 03.07 · 8:00 → 10:00",
// vícedenní „PO 29.06 8:00 → ST 01.07 16:00"
function fmtKniha(from, to) {
  const fd = new Date(from), td = new Date(to);
  const day = d => CS_DAYS_SHORT[(getDay(d) + 6) % 7].toUpperCase();
  if (isSameDay(fd, td)) {
    return `${day(fd)} ${format(fd, 'dd.MM')} · ${fmtTime(fd)} → ${fmtTime(td)}`;
  }
  return `${day(fd)} ${format(fd, 'dd.MM')} ${fmtTime(fd)} → ${day(td)} ${format(td, 'dd.MM')} ${fmtTime(td)}`;
}

function calendarGrid(month) {
  const first = startOfMonth(month);
  const last  = endOfMonth(month);
  const days  = eachDayOfInterval({ start: first, end: last });
  const offset = (getDay(first) + 6) % 7; // Mon=0
  return [...Array(offset).fill(null), ...days];
}

// ── geometrie týdenní hodinové mřížky ────────────────────────────────────────
const HOUR_PX = 22; // výška jedné hodiny v týdenním pohledu (24 h = 528 px)

// Převod časů (vč. minut) na absolutní pozici bloku ve sloupci dne.
// top i bottom se zaokrouhlují z POZIC (ne z délky) — navazující rezervace
// sdílejí tentýž okamžik, takže bottom(A) === top(B) vždy, a −1 px dole
// dává konzistentní 1px spáru u všech navazujících bloků.
// Floor 4 px = pojistka viditelnosti (formulář stejně povoluje min. 15 min).
function weekBlockGeometry(startHours, endHours) {
  const top    = Math.round(startHours * HOUR_PX);
  const bottom = Math.round(endHours   * HOUR_PX);
  const height = Math.max(bottom - top - 1, 4);
  return { top, height };
}

// ── volný čas dne pro mobilní agendu ─────────────────────────────────────────
// Ořízne rezervace daného dne na okno dne, slije překrývající se intervaly
// a podle mezer rozhodne o „Volno" boxu. DNEŠEK se počítá od aktuálního času
// (už uplynulé mezery se ignorují), budoucí dny od půlnoci.
// Vrací null (= plně zabráno, box nerenderovat) nebo { title }.
// Rezervace už skončila → v kalendáři se kreslí ztlumeně a nejde upravit
// (updateBooking vyžaduje budoucí datum, editace by skončila matoucí chybou).
const isPastBooking = (b, now) => new Date(b.dateTo) <= now;
const PAST_MSG = 'Minulou rezervaci už nelze upravit.';

function dayFreeInfo(day, bookings) {
  const now      = new Date();
  const dayStart = startOfDay(day);
  const dayEnd   = addDays(dayStart, 1);
  const windowStart = isSameDay(day, now) && now > dayStart ? now : dayStart;
  if (windowStart >= dayEnd) return null;

  // intervaly oříznuté na okno dne
  const intervals = bookings
    .map(b => ({
      from: new Date(b.dateFrom) > windowStart ? new Date(b.dateFrom) : windowStart,
      to:   new Date(b.dateTo)   < dayEnd      ? new Date(b.dateTo)   : dayEnd,
    }))
    .filter(iv => iv.from < iv.to)
    .sort((a, b) => a.from - b.from);

  // slití překryvů/navazujících
  const merged = [];
  for (const iv of intervals) {
    const last = merged[merged.length - 1];
    if (last && iv.from <= last.to) {
      if (iv.to > last.to) last.to = iv.to;
    } else {
      merged.push({ ...iv });
    }
  }

  if (!merged.length) return { title: 'Celý den volno' };

  const freeEnd     = merged[merged.length - 1].to < dayEnd;
  const freeStart   = merged[0].from > windowStart;
  const hasInnerGap = merged.some((iv, i) => i > 0 && merged[i - 1].to < iv.from);

  if (freeEnd)     return { title: `Volno od ${fmtTime(merged[merged.length - 1].to)}` };
  if (freeStart)   return { title: `Volno do ${fmtTime(merged[0].from)}` };
  if (hasInnerGap) return { title: 'Volno během dne' };
  return null; // den plně zabraný
}

// ── status vozidla pro kartu ─────────────────────────────────────────────────
// Čistě klientský dopočet z rezervací všech aut (fleetBookings, GET /bookings
// bez filtru). Logika dle prototypu z handoffu:
//  - běží teď rezervace → „Má ji {Příjmení} · vrátí do H:MM" (navazující/
//    překrývající rezervace se řetězí do jednoho konce; přes půlnoc → s datem)
//  - jinak další dnešní → „Volná do H:MM"
//  - jinak volno → „Volná celý den" / „Volná po zbytek dne" (pokud už dnes
//    nějaká proběhla)
// Vrací { text, dot } — dot je barva tečky (zelená volná / oranžová obsazená).
function statusOf(vehicleId, fleetBookings) {
  const now = new Date();
  const list = fleetBookings
    .filter(b => b.vehicleId === vehicleId)
    .map(b => ({
      from: new Date(b.dateFrom),
      to: new Date(b.dateTo),
      surname: b.user?.lastName ?? '',
    }))
    .sort((a, b) => a.from - b.from);

  const FREE = 'var(--color-dot-free)';
  const BUSY = 'var(--color-warn)';

  // Běžící rezervace teď?
  const running = list.find(b => b.from <= now && now < b.to);
  if (running) {
    // Řetězení: dokud další rezervace začíná před koncem řetězu, posouvej konec
    let end = running.to;
    let extended = true;
    while (extended) {
      extended = false;
      for (const b of list) {
        if (b.from <= end && b.to > end) { end = b.to; extended = true; }
      }
    }
    const text = isSameDay(end, now)
      ? `Má ji ${running.surname} · vrátí do ${fmtTime(end)}`
      : `Má ji ${running.surname} · vrátí ${format(end, 'dd.MM.')} ${fmtTime(end)}`;
    return { text, dot: BUSY };
  }

  // Nejbližší dnešní budoucí rezervace?
  const nextToday = list.find(b => b.from > now && isSameDay(b.from, now));
  if (nextToday) {
    return { text: `Volná do ${fmtTime(nextToday.from)}`, dot: FREE };
  }

  // Volno do konce dne — rozliš, jestli dnes už něco proběhlo
  const hadToday = list.some(b => b.to <= now && isSameDay(b.to, now));
  return { text: hadToday ? 'Volná po zbytek dne' : 'Volná celý den', dot: FREE };
}

function emptyForm(pre = {}) {
  const now = new Date();
  const cy  = now.getFullYear();
  return {
    fromDay: pre.day ?? '', fromMonth: pre.month ?? String(now.getMonth() + 1),
    fromYear: pre.year ?? cy, fromHour: pre.hour ?? 8, fromMinute: 0,
    toDay: pre.day ?? '', toMonth: pre.month ?? String(now.getMonth() + 1),
    toYear: pre.year ?? cy, toHour: pre.toHour ?? (pre.hour != null ? Math.min(+pre.hour + 1, 23) : 10),
    toMinute: 0,
    purpose: '',
  };
}

// allowPastStart = úprava PRÁVĚ PROBÍHAJÍCÍ rezervace (začátek už proběhl a je
// v UI zamčený, mění se jen konec). Zrcadlí validateDates na serveru — dřív se
// při editaci kontrola minulosti vypínala úplně, takže klient pustil i to,
// co server vzápětí odmítl.
function validateForm(f, { allowPastStart = false } = {}) {
  const from = buildDate(f.fromYear, f.fromMonth, f.fromDay, f.fromHour, f.fromMinute);
  const to   = buildDate(f.toYear,   f.toMonth,   f.toDay,   f.toHour,   f.toMinute);
  if (!from || !to) return 'Vyplňte datum a čas.';
  if (!allowPastStart && from < new Date()) return 'Datum od nesmí být v minulosti.';
  if (to <= from) return 'Datum do musí být po datu od.';
  if (allowPastStart && to <= new Date()) return 'Konec probíhající rezervace musí být v budoucnosti.';
  if (to - from > MAX_BOOKING_DAYS * 24 * 60 * 60 * 1000) {
    return `Rezervace může být nejdéle ${MAX_BOOKING_DAYS} dní.`;
  }
  return null;
}

// ── icons ────────────────────────────────────────────────────────────────────

function CarIcon({ color = '#fff', size = 30 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
      style={{ color }}>
      <path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2" />
      <circle cx="7" cy="17" r="2" />
      <path d="M9 17h6" />
      <circle cx="17" cy="17" r="2" />
    </svg>
  );
}

function VanIcon({ color = '#fff', size = 30 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
      style={{ color }}>
      <path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2" />
      <path d="M15 18H9" />
      <path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62l-3.48-4.35A1 1 0 0 0 17.52 8H14" />
      <circle cx="17" cy="18" r="2" />
      <circle cx="7" cy="18" r="2" />
    </svg>
  );
}

// Heuristika typu vozidla podle názvu (osobní vs. dodávka)
function isVanVehicle(name = '') {
  return /dod[áa]vk|\bvan\b|transporter|ducato|crafter|master|sprinter|caddy|transit/i.test(name);
}

function PencilIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

function ChevronIcon({ dir }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d={dir === 'left' ? 'M15 18l-6-6 6-6' : 'M9 18l6-6-6-6'} />
    </svg>
  );
}

function EyeIcon({ visible }) {
  return visible ? (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ) : (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

// ── Select component ─────────────────────────────────────────────────────────

function Sel({ value, onChange, children, style = {}, disabled = false }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      disabled={disabled}
      style={{
        height: 42, border: '1px solid var(--color-input)', borderRadius: 10,
        fontFamily: T.sg, fontSize: 13, color: T.ink,
        background: disabled ? 'var(--color-line-grid)' : 'var(--color-input-bg)',
        padding: '0 8px', cursor: disabled ? 'not-allowed' : 'pointer', outline: 'none',
        transition: 'border-color .15s',
        ...style,
      }}
      onFocus={e  => (e.target.style.borderColor = T.signal)}
      onBlur={e   => (e.target.style.borderColor = 'var(--color-input)')}
    >
      {children}
    </select>
  );
}

// ── DateTimeGroup ─────────────────────────────────────────────────────────────

function DateTimeGroup({ prefix, form, setF, disabled = false }) {
  const now = new Date();
  const cy  = now.getFullYear();

  const month = +form[`${prefix}Month`];
  const year  = +form[`${prefix}Year`];
  const daysCount = month && year ? new Date(year, month, 0).getDate() : 31;

  const isCurrentYear  = year === now.getFullYear();
  const isCurrentMonth = isCurrentYear && month === now.getMonth() + 1;

  // Zamčená skupina (běžící rezervace): hodnoty se pořád musí zobrazit, i když
  // leží v minulosti — proto se u disabled nefiltrují dny/měsíce/roky pryč,
  // jinak by select vypadal prázdně.
  const keepAll = disabled;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, opacity: disabled ? 0.6 : 1 }}>
      {/* Date row */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <Sel value={form[`${prefix}Day`]} onChange={v => setF(`${prefix}Day`, v)} style={{ width: 62 }} disabled={disabled}>
          <option value="">Den</option>
          {Array.from({ length: daysCount }, (_, i) => {
            const d = i + 1;
            const tooEarly = !keepAll && isCurrentMonth && d < now.getDate();
            return tooEarly ? null : <option key={d} value={d}>{String(d).padStart(2,'0')}</option>;
          })}
        </Sel>
        <Sel value={form[`${prefix}Month`]} onChange={v => setF(`${prefix}Month`, v)} style={{ flex: 1, minWidth: 110 }} disabled={disabled}>
          <option value="">Měsíc</option>
          {CS_MONTHS.map((m, i) => {
            const tooEarly = !keepAll && isCurrentYear && i < now.getMonth();
            return tooEarly ? null : <option key={i+1} value={i+1}>{m}</option>;
          })}
        </Sel>
        <Sel value={form[`${prefix}Year`]} onChange={v => setF(`${prefix}Year`, v)} style={{ width: 76 }} disabled={disabled}>
          {Array.from({ length: 4 }, (_, i) => cy + i)
            .concat(keepAll && year && year < cy ? [year] : [])
            .sort((a, b) => a - b)
            .map(y => <option key={y} value={y}>{y}</option>)}
        </Sel>
      </div>
      {/* Time row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Sel value={form[`${prefix}Hour`]} onChange={v => setF(`${prefix}Hour`, v)} style={{ width: 70 }} disabled={disabled}>
          {Array.from({ length: 24 }, (_, i) => (
            <option key={i} value={i}>{String(i).padStart(2,'0')}</option>
          ))}
        </Sel>
        <span style={{ color: T.ink50, fontFamily: T.manrope, fontSize: 13 }}>:</span>
        <Sel value={form[`${prefix}Minute`]} onChange={v => setF(`${prefix}Minute`, v)} style={{ width: 66 }} disabled={disabled}>
          {[0,15,30,45].concat(keepAll && ![0,15,30,45].includes(+form[`${prefix}Minute`]) ? [+form[`${prefix}Minute`]] : [])
            .sort((a, b) => a - b)
            .map(m => (
              <option key={m} value={m}>{String(m).padStart(2,'0')}</option>
            ))}
        </Sel>
      </div>
    </div>
  );
}

// ── MAIN COMPONENT ────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { user, logout, updateUser, pendingCount, setPendingCount } = useAuth();
  const navigate = useNavigate();

  const [allBookings, setAllBookings] = useState([]);
  const [myBookings,  setMyBookings]  = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [loadError,   setLoadError]   = useState(false);
  const [currentMonth, setCurrentMonth] = useState(startOfMonth(new Date()));

  // Mobilní agenda — čistě navigační UI stavy (jako currentMonth):
  // vybraný den v pásu dnů + offset zobrazeného týdne (šipkami ‹ ›)
  const [selectedDay,     setSelectedDay]     = useState(() => startOfDay(new Date()));
  const [stripWeekOffset, setStripWeekOffset] = useState(0);

  // Týdenní pohled (desktop-only): přepínač Týden|Měsíc + kotva týdne.
  // Navigační UI stavy; pohled se persistuje v localStorage (default měsíc).
  const [calendarView, setCalendarView] = useState(() =>
    localStorage.getItem('calendarView') === 'week' ? 'week' : 'month'
  );
  const [weekStart, setWeekStart] = useState(() => {
    const t = startOfDay(new Date());
    return addDays(t, -((getDay(t) + 6) % 7)); // pondělí aktuálního týdne
  });

  function changeView(v) {
    setCalendarView(v);
    localStorage.setItem('calendarView', v);
  }

  // vehicles (přepínač aut)
  const [vehicles,          setVehicles]          = useState([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState(null);
  const [vehiclesLoading,   setVehiclesLoading]   = useState(true);
  const [vehiclesError,     setVehiclesError]     = useState(false);
  // rezervace VŠECH aut — výhradně pro dopočet statusů karet (statusOf)
  const [fleetBookings,     setFleetBookings]     = useState([]);

  // modal state
  const [modal,    setModal]    = useState(null); // null | {type:'create'|'edit', booking?}
  const [mForm,    setMForm]    = useState(emptyForm());
  const [mError,   setMError]   = useState('');
  const [mLoading, setMLoading] = useState(false);
  const [bookFilter, setBookFilter] = useState('all'); // 'all' | 'mine'
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteError,  setDeleteError]  = useState('');
  const [toast, setToast] = useState(null); // null | { msg: string }
  const [menuOpen, setMenuOpen] = useState(false);

  // ── pravidla používání vozidla ──────────────────────────────────────────────
  // Text i číslo verze přicházejí z DB (GET /api/rules). Gate se řídí VERZÍ:
  // publikace nové verze zneplatní dosavadní potvrzení. Fail-open — dokud se
  // pravidla nenačtou (nebo fetch selže), gate se neukáže; jistí to server guard.
  const [rules, setRules] = useState(null); // { version, sections } | null
  const rulesGate = !!user && !!rules && user.rulesAcceptedVersion !== rules.version;
  const [rulesView, setRulesView]     = useState(false); // read-only náhled z menu
  const [rulesSaving, setRulesSaving] = useState(false);
  const [rulesError, setRulesError]   = useState('');

  useEffect(() => {
    api.get('/rules')
      .then(r => setRules(r.data))
      .catch(() => {}); // fail-open, viz výše
  }, []);

  async function handleAcceptRules() {
    setRulesSaving(true);
    setRulesError('');
    try {
      // posílá se verze, kterou uživatel právě četl — když mezitím vyšla
      // novější, cache se nezvýší a gate naskočí znovu (řeší server)
      const { data } = await api.post('/auth/accept-rules', { version: rules.version });
      updateUser({
        rulesAcceptedAt: data.rulesAcceptedAt,
        rulesAcceptedVersion: data.rulesAcceptedVersion, // gate zmizí sám
      });
    } catch {
      setRulesError('Potvrzení se nepodařilo uložit. Zkuste to prosím znovu.');
    } finally {
      setRulesSaving(false);
    }
  }
  const [changePwModal,   setChangePwModal]   = useState(false);
  const [changePwForm,    setChangePwForm]    = useState({ current: '', newPw: '', confirm: '' });
  const [changePwError,   setChangePwError]   = useState('');
  const [changePwLoading, setChangePwLoading] = useState(false);
  const [showPw, setShowPw] = useState({ current: false, newPw: false, confirm: false });
  const menuRef = useRef(null);
  const swipeStart = useRef(null);
  const [dayDetail, setDayDetail] = useState(null); // Date | null

  // ── fetch ────────────────────────────────────────────────────────────────────

  const fetchVehicles = useCallback(async () => {
    setVehiclesLoading(true);
    setVehiclesError(false);
    try {
      const { data } = await api.get('/vehicles');
      setVehicles(data);
      setSelectedVehicleId(prev => {
        if (prev && data.some(v => v.id === prev)) return prev;
        return data.length > 0 ? data[0].id : null;
      });
    } catch (e) {
      console.error('fetchVehicles error:', e);
      setVehiclesError(true);
    } finally {
      setVehiclesLoading(false);
    }
  }, []);

  useEffect(() => { fetchVehicles(); }, [fetchVehicles]);

  // Epocha zneplatnění rozjetých načtení — sdílená pro `fetchAll` i polling.
  // Přepnutí auta nebo otevření/zavření modalu (= každá mutace, ty jdou vždy
  // přes modal) ji zvedne; načtení, které mezitím zestárlo, svůj výsledek
  // ZAHODÍ. Bez toho může opožděná odpověď přepsat čerstvější stav —
  // kalendář starého auta pod jménem nového, nebo zombie smazaná rezervace.
  const dataEpoch = useRef(0);

  // (deklarace nahoře — potřebují ji epocha i polling jako pauzu)
  const anyModalOpen = !!modal || changePwModal || !!deleteTarget || !!dayDetail || rulesGate || rulesView;

  // POŘADÍ JE PODSTATNÉ: tenhle effect musí být deklarovaný PŘED effectem,
  // který volá fetchAll — effecty běží v pořadí deklarace, takže se epocha
  // zvedne dřív, než si ji čerstvý fetchAll zapamatuje (jinak by zahodil
  // vlastní výsledek).
  useEffect(() => { dataEpoch.current += 1; }, [selectedVehicleId, anyModalOpen]);

  const fetchAll = useCallback(async () => {
    if (!selectedVehicleId) return;
    const epoch = dataEpoch.current;
    setLoading(true);
    setLoadError(false);
    try {
      const [fleet, mine] = await Promise.all([
        api.get('/bookings'),      // bez filtru — všechna auta jedním dotazem
        api.get('/bookings/mine'),
      ]);
      if (epoch !== dataEpoch.current) return; // mezitím se přepnulo auto → zahodit
      // allBookings = jen vybrané auto (identický tvar jako dřívější
      // serverový filtr ?vehicleId=X — stejná query, filtr jen přesunut sem)
      setAllBookings(fleet.data.filter(b => b.vehicleId === selectedVehicleId));
      setMyBookings(mine.data);
      setFleetBookings(fleet.data); // plné pole — statusy karet
    } catch (e) {
      console.error('fetchAll error:', e);
      if (epoch === dataEpoch.current) setLoadError(true);
    } finally {
      // loading vypíná jen aktuální načtení — jinak by zestaralé doběhnutí
      // sundalo ztmavení, zatímco čerstvé ještě běží
      if (epoch === dataEpoch.current) setLoading(false);
    }
  }, [selectedVehicleId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // ── tikající „teď" ───────────────────────────────────────────────────────────
  // Dřív se `now` počítalo při každém renderu — jenže díky no-change skipu
  // v pollingu se komponenta na klidné flotile nepřekresluje vůbec, takže
  // `now` zamrzlo: po půlnoci svítil včerejšek jako dnešek a doběhlé rezervace
  // zůstávaly nezašedlé a klikatelné (klik → 400 ze serveru).
  // Minuta stačí — hranice „minulé vs. probíhající vs. budoucí" se po
  // sekundách nemění — a proti 6 tickům pollingu za minutu je to zanedbatelné.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = () => setNow(new Date());
    const id = setInterval(tick, 60000);
    // návrat na záložku: prohlížeč timery na pozadí škrtí, takže dorovnat hned
    const onVis = () => { if (!document.hidden) tick(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, []);

  // ── polling (Fáze 3: real-time) ──────────────────────────────────────────────
  // Tichá varianta fetchAll: žádné loading stavy (nic neprobliká), chyby se
  // tiše ignorují (poslední známá data zůstávají; 401 vykopne axios interceptor),
  // no-change skip = při shodě dat se setState nevolá (nulový re-render).
  const pollBusy  = useRef(false); // in-flight guard — nikdy dva fetche přes sebe
  const pollCount = useRef(0);
  const pollWasPaused = useRef(false);

  const pollTick = useCallback(async () => {
    if (pollBusy.current) return;
    pollBusy.current = true;
    try {
      const epoch = dataEpoch.current; // sdílená epocha, viz fetchAll výše
      const slowLane = pollCount.current % 6 === 5; // každý 6. tick (1×/min)
      pollCount.current += 1;
      // allSettled — selhání slow lane nesmí zahodit úspěšně stažené rezervace.
      // Bez vybraného auta (nula aktivních aut) se stahují jen /vehicles, a to
      // každý tick — klient se ze stavu „žádná auta" zotaví bez F5.
      const [fleetR, mineR, vehR, pendR, rulesR] = await Promise.allSettled([
        selectedVehicleId ? api.get('/bookings') : Promise.resolve(null),
        selectedVehicleId ? api.get('/bookings/mine') : Promise.resolve(null),
        (slowLane || !selectedVehicleId) ? api.get('/vehicles') : Promise.resolve(null),
        // jen admin — běžnému uživateli by endpoint vracel 403 každou minutu
        slowLane && user?.isAdmin ? api.get('/admin/registrations/pending') : Promise.resolve(null),
        // verze pravidel — publikace nové verze naskočí gate do minuty, ne až po F5
        slowLane ? api.get('/rules') : Promise.resolve(null),
      ]);
      if (epoch !== dataEpoch.current) return; // tick zestárnul — výsledek zahodit

      const same  = (prev, next) => JSON.stringify(prev) === JSON.stringify(next);
      const fleet = fleetR.status === 'fulfilled' ? fleetR.value : null;
      const mine  = mineR.status  === 'fulfilled' ? mineR.value  : null;
      const veh   = vehR.status   === 'fulfilled' ? vehR.value   : null;
      const pend  = pendR.status  === 'fulfilled' ? pendR.value  : null;
      const rls   = rulesR.status === 'fulfilled' ? rulesR.value : null;

      if (fleet && mine) {
        const filtered = fleet.data.filter(b => b.vehicleId === selectedVehicleId);
        setFleetBookings(prev => same(prev, fleet.data) ? prev : fleet.data);
        setAllBookings(prev => same(prev, filtered) ? prev : filtered);
        setMyBookings(prev => same(prev, mine.data) ? prev : mine.data);
        setLoadError(false); // úspěšný tick zhojí případný dřívější výpadek
      }
      if (veh) {
        setVehicles(prev => same(prev, veh.data) ? prev : veh.data);
        // stejný fallback jako fetchVehicles — vyřazené vybrané auto → první v seznamu
        setSelectedVehicleId(prev =>
          prev && veh.data.some(v => v.id === prev) ? prev : (veh.data[0]?.id ?? null)
        );
      }
      if (pend) setPendingCount(pend.data.length); // badge čekajících bez F5
      if (rls) setRules(prev => same(prev, rls.data) ? prev : rls.data);
    } catch {
      // tiše — žádný toast každých 10 s (401 vykopne axios interceptor)
    } finally {
      pollBusy.current = false;
    }
  }, [selectedVehicleId, user?.isAdmin]);

  useEffect(() => {
    // Epochu zvedá sdílený effect výše (přepnutí auta / modal), ať se
    // nezneplatní i čerstvé načtení spuštěné toutéž změnou.
    if (anyModalOpen) {
      // pauza — rozdělaná práce v modalu se nesmí rušit (menu polling neblokuje)
      pollWasPaused.current = true;
      return;
    }
    let id = null;
    const start = () => { if (id === null) id = setInterval(pollTick, POLL_MS); };
    const stop  = () => { if (id !== null) { clearInterval(id); id = null; } };
    const onVis = () => {
      if (document.hidden) stop();
      else { pollTick(); start(); } // návrat na záložku = okamžitý tick
    };
    if (pollWasPaused.current) {
      pollWasPaused.current = false;
      pollTick(); // odpauzování (modal zavřen) = okamžitý catch-up tick
    }
    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVis);
    return () => { stop(); document.removeEventListener('visibilitychange', onVis); };
  }, [anyModalOpen, pollTick]);

  useEffect(() => {
    if (!user?.isAdmin) return;
    api.get('/admin/registrations/pending')
      .then(r => setPendingCount(r.data.length))
      .catch(() => {});
  }, [user?.isAdmin]);

  useEffect(() => {
    if (!menuOpen) return;
    function onOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, [menuOpen]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    // Menu locke scroll jen v mobilním režimu (bottom sheet přes celou
    // obrazovku); desktopový dropdown scroll stránky neblokuje.
    const mq = window.matchMedia('(max-width: 639px)');
    const apply = () => {
      document.body.style.overflow = (anyModalOpen || (menuOpen && mq.matches)) ? 'hidden' : '';
    };
    apply();
    mq.addEventListener('change', apply);
    return () => {
      mq.removeEventListener('change', apply);
      document.body.style.overflow = '';
    };
  }, [anyModalOpen, menuOpen]);

  const myIds = new Set(myBookings.map(b => b.id));

  // ── derived ──────────────────────────────────────────────────────────────────

  const selectedVehicle = vehicles.find(v => v.id === selectedVehicleId) || null;

  const activeBooking = allBookings.find(
    b => new Date(b.dateFrom) <= now && new Date(b.dateTo) > now
  );
  const nextBooking = allBookings.find(b => new Date(b.dateFrom) > now);

  const initials = user
    ? `${user.firstName[0]}${user.lastName[0]}`.toUpperCase()
    : '?';

  // ── modal helpers ─────────────────────────────────────────────────────────────

  const setF = (key, val) => setMForm(f => ({ ...f, [key]: val }));

  function openCreate(pre = {}) {
    setMForm(emptyForm(pre));
    setMError('');
    setModal({ type: 'create' });
  }

  function openEdit(b) {
    const from = new Date(b.dateFrom), to = new Date(b.dateTo);
    setMForm({
      fromDay: String(from.getDate()), fromMonth: String(from.getMonth()+1),
      fromYear: from.getFullYear(), fromHour: from.getHours(), fromMinute: from.getMinutes(),
      toDay: String(to.getDate()), toMonth: String(to.getMonth()+1),
      toYear: to.getFullYear(), toHour: to.getHours(), toMinute: to.getMinutes(),
      purpose: b.purpose,
    });
    setMError('');
    setModal({ type: 'edit', booking: b });
  }

  // ── swipe handlers (calendar month navigation) ───────────────────────────────

  function handleCalTouchStart(e) {
    swipeStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }

  function handleCalTouchEnd(e) {
    if (!swipeStart.current) return;
    const dx = e.changedTouches[0].clientX - swipeStart.current.x;
    const dy = e.changedTouches[0].clientY - swipeStart.current.y;
    swipeStart.current = null;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    // only horizontal swipe: min 70px AND horizontal > 2× vertical
    if (Math.abs(dx) < 70 || Math.abs(dx) <= Math.abs(dy) * 2) return;
    setCurrentMonth(m => dx < 0 ? addMonths(m, 1) : subMonths(m, 1));
  }

  // ── mutations ─────────────────────────────────────────────────────────────────

  async function handleSubmit(e) {
    e.preventDefault();
    const isEdit = modal?.type === 'edit';
    const err    = validateForm(mForm, { allowPastStart: editingRunning });
    if (err) { setMError(err); return; }
    setMError(''); setMLoading(true);
    const body = {
      vehicleId: selectedVehicleId,
      dateFrom: buildISO(mForm.fromYear, mForm.fromMonth, mForm.fromDay, mForm.fromHour, mForm.fromMinute),
      dateTo:   buildISO(mForm.toYear,   mForm.toMonth,   mForm.toDay,   mForm.toHour,   mForm.toMinute),
      purpose:  mForm.purpose,
    };
    try {
      if (isEdit) await api.put(`/bookings/${modal.booking.id}`, body);
      else        await api.post('/bookings', body);
      await fetchAll();
      fetchVehicles(); // tečky dostupnosti na kartách
      setModal(null);
      setToast({ msg: isEdit ? 'Rezervace upravena.' : 'Rezervace uložena.' });
    } catch (err) {
      const msg  = err.response?.data?.message || 'Chyba při ukládání rezervace.';
      const next = err.response?.data?.nextAvailable;
      setMError(next ? `${msg} Nejbližší volný termín: ${fmtShort(next)}.` : msg);
    } finally {
      setMLoading(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleteError('');
    try {
      await api.delete(`/bookings/${deleteTarget.id}`);
      await fetchAll(); // jednotný refresh: allBookings + myBookings + fleetBookings (statusy karet)
      fetchVehicles();
      setDeleteTarget(null);
      setToast({ msg: 'Rezervace zrušena.', variant: 'danger' });
    } catch (err) {
      setDeleteError(err.response?.data?.message || 'Nepodařilo se smazat rezervaci.');
    }
  }

  async function handleChangePw(e) {
    e.preventDefault();
    setChangePwError('');
    const { current, newPw, confirm } = changePwForm;
    if (newPw.length < 8) { setChangePwError('Nové heslo musí mít alespoň 8 znaků.'); return; }
    if (newPw !== confirm) { setChangePwError('Nová hesla se neshodují.'); return; }
    setChangePwLoading(true);
    try {
      await api.post('/auth/change-password', { currentPassword: current, newPassword: newPw });
      setChangePwModal(false);
      setChangePwForm({ current: '', newPw: '', confirm: '' });
      setShowPw({ current: false, newPw: false, confirm: false });
      setToast({ msg: 'Heslo bylo změněno.' });
    } catch (err) {
      setChangePwError(err.response?.data?.message || 'Chyba při změně hesla.');
    } finally {
      setChangePwLoading(false);
    }
  }

  // ── calendar data ─────────────────────────────────────────────────────────────

  const grid = calendarGrid(currentMonth);

  // For each day, collect bookings that overlap (dateFrom.date <= day <= dateTo.date)
  function bookingsOnDay(day) {
    return allBookings.filter(b => {
      const fd = startOfDay(parseISO(b.dateFrom));
      const td = startOfDay(parseISO(b.dateTo));
      return fd <= day && day <= td;
    });
  }

  // Calendar booking chips for a cell — každý den samostatný chip,
  // kontinuitu vícedenní rezervace nese text („8:00" / „celý den" / „→ 16:00")
  function CellBookings({ day }) {
    const bks = bookingsOnDay(day);
    if (!bks.length) return null;
    // 11px font: do nejnižší buňky (88px, 6řádkový měsíc) se vejdou 3 chipy
    // BEZ „+N", nebo 2 chipy S „+N" — proto se při ≥4 rezervacích ukazují jen 2
    const maxVisible = bks.length > 3 ? 2 : 3;
    const visible = bks.slice(0, maxVisible);
    const extra   = bks.length - visible.length;
    return (
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {visible.map(b => {
          const mine        = myIds.has(b.id);
          const past        = isPastBooking(b, now);
          const canInteract = !past && (mine || user?.isAdmin);
          const isFirstDay  = isSameDay(day, startOfDay(parseISO(b.dateFrom)));
          const isLastDay   = isSameDay(day, startOfDay(parseISO(b.dateTo)));
          const isSingleDay = isFirstDay && isLastDay;
          const fullName    = `${b.user?.firstName ?? ''} ${b.user?.lastName ?? ''}`.trim();
          const who         = mine ? 'vy' : (b.user?.lastName ?? '');

          // Label: jednodenní → celý rozsah od–do (vlastnictví nese barva),
          // vícedenní → první „8:00 vy", prostřední „celý den vy", poslední „→ 16:00 vy"
          const label = isSingleDay
            ? `${fmtTime(parseISO(b.dateFrom))}–${fmtTime(parseISO(b.dateTo))}`
            : isFirstDay
              ? `${fmtTime(parseISO(b.dateFrom))} ${who}`
              : isLastDay
                ? `→ ${fmtTime(parseISO(b.dateTo))} ${who}`
                : `celý den ${who}`;

          return (
            <div
              key={b.id}
              className="cal-strip"
              onClick={e => {
                e.stopPropagation();
                if (past) setToast({ msg: PAST_MSG });
                else if (canInteract) openEdit(b);
              }}
              style={{
                marginTop: 3, padding: '2px 5px', borderRadius: 4,
                fontFamily: T.sg, fontSize: 11, fontWeight: 600, lineHeight: 1,
                background: mine ? T.signal : T.ink, color: '#fff',
                overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                cursor: canInteract ? 'pointer' : 'default',
                userSelect: 'none',
                opacity: past ? 0.4 : 1,   // proběhlé rezervace ztlumené
              }}
              title={`${fullName} · ${fmtRange(b.dateFrom, b.dateTo)}`}
            >
              <span className="strip-text">{label}</span>
            </div>
          );
        })}
        {extra > 0 && (
          <div style={{ fontFamily: T.mono, fontSize: 10, color: T.ink50, paddingLeft: 2, marginTop: 3 }}>
            +{extra}
          </div>
        )}
      </div>
    );
  }

  // ── agenda list ───────────────────────────────────────────────────────────────

  const myBookingsForVehicle = myBookings.filter(b => b.vehicle?.id === selectedVehicleId);
  const agendaList = (bookFilter === 'mine' ? myBookingsForVehicle : allBookings)
    .filter(b => new Date(b.dateTo) > now);

  // ── render ────────────────────────────────────────────────────────────────────

  const isEdit    = modal?.type === 'edit';
  const modalOpen = modal !== null;
  // Právě probíhající rezervace: začátek už proběhl → jde měnit jen konec
  // (prodloužit/zkrátit). Zamykáme pole „Od" a validujeme podle toho.
  const editingRunning = isEdit && !!modal.booking
    && new Date(modal.booking.dateFrom) <= now
    && new Date(modal.booking.dateTo) > now;

  const dayBookings = dayDetail
    ? allBookings
        .filter(b => {
          const fd = startOfDay(parseISO(b.dateFrom));
          const td = startOfDay(parseISO(b.dateTo));
          return fd <= dayDetail && dayDetail <= td;
        })
        .sort((a, b) => new Date(a.dateFrom) - new Date(b.dateFrom))
    : [];
  const inPastDay = dayDetail
    && isBefore(dayDetail, startOfDay(now))
    && !isSameDay(dayDetail, now);

  return (
    <div style={{ minHeight: '100vh', background: T.base, fontFamily: T.inter }}>

      {/* ── HEADER ──────────────────────────────────────────────────────────────── */}
      <header style={{
        background: T.base,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 28px',
        borderBottom: `1px solid ${T.line}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <Wordmark size={17} />
          <span className="hdr-subtitle" style={{
            fontFamily: T.mono, fontWeight: 500, fontSize: 10, color: T.ink30,
            textTransform: 'uppercase', letterSpacing: '0.18em',
          }}>
            Rezervace vozidel
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* Statický otisk data/času při renderu — žádné tikající hodiny */}
          <span className="hdr-clock" style={{ fontFamily: T.mono, fontWeight: 500, fontSize: 11, color: T.ink30 }}>
            {`${CS_DAYS_SHORT[(getDay(now) + 6) % 7].toUpperCase()} ${format(now, 'dd.MM')} · ${fmtTime(now)}`}
          </span>

          {/* User pill — unified dropdown for desktop + mobile */}
          <div style={{ position: 'relative' }} ref={menuRef}>
            <button
              className="hdr-pill"
              onClick={() => setMenuOpen(v => !v)}
              aria-label={`Nabídka uživatele ${user?.firstName ?? ''} ${user?.lastName ?? ''}`}
              aria-expanded={menuOpen}
              style={{
                display: 'flex', alignItems: 'center', gap: 9,
                background: T.field, border: `1px solid ${T.line}`,
                borderRadius: 10, padding: '5px 10px', cursor: 'pointer',
                transition: 'border-color .15s',
              }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--color-ink-10)')}
              onMouseLeave={e => (e.currentTarget.style.borderColor = T.line)}
            >
              <div style={{ position: 'relative', flexShrink: 0 }}>
                <div className="hdr-avatar" style={{
                  width: 26, height: 26, borderRadius: 7,
                  background: T.ink,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: T.mono, fontWeight: 600, fontSize: 10,
                  color: 'var(--color-signal-light)',
                }}>
                  {initials}
                </div>
                {user?.isAdmin && pendingCount > 0 && (
                  <span style={{
                    position: 'absolute', top: -6, right: -6,
                    background: 'var(--color-danger)', color: '#fff',
                    borderRadius: '50%', minWidth: 16, height: 16,
                    fontSize: 9, fontWeight: 700, fontFamily: T.mono,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    padding: '0 3px', lineHeight: 1,
                    border: `2px solid ${T.field}`,
                    boxSizing: 'border-box', pointerEvents: 'none',
                  }}>
                    {pendingCount > 9 ? '9+' : pendingCount}
                  </span>
                )}
              </div>
              <span className="hdr-uname" style={{ fontSize: 13, fontWeight: 600, color: T.ink }}>
                {user?.firstName} {user?.lastName}
              </span>
              {user?.isAdmin && (
                <span className="hdr-uadmin" style={{
                  fontFamily: T.mono, fontWeight: 600, fontSize: 9,
                  letterSpacing: '0.1em', padding: '2px 6px',
                  background: 'var(--color-signal-bg)',
                  border: '1px solid var(--color-signal-border)',
                  borderRadius: 4, color: 'var(--color-signal-link)',
                }}>
                  ADMIN
                </span>
              )}
              <span className="hdr-chev" aria-hidden="true" style={{ color: T.ink30, fontSize: 10 }}>▾</span>
            </button>

            {/* Overlay pod mobilním sheetem (na desktopu skrytý přes CSS) */}
            {menuOpen && (
              <div
                className="hdr-menu-overlay"
                onClick={() => setMenuOpen(false)}
                aria-hidden="true"
              />
            )}

            {menuOpen && (
              <div className="hdr-menu" style={{
                position: 'absolute', top: 42, right: 0,
                width: 240, maxWidth: 'calc(100vw - 32px)',
                background: T.field, borderRadius: 12,
                border: `1px solid ${T.line}`,
                boxShadow: '0 14px 34px rgba(12,27,42,.16)',
                zIndex: 100, overflow: 'hidden',
              }}>
                {/* Drag handle — jen mobilní sheet */}
                <div className="hdr-sheet-only" style={{
                  width: 36, height: 4, borderRadius: 2,
                  background: T.line, margin: '10px auto 0',
                }} />
                {/* Hlavička: (avatar na mobilu) + jméno + ADMIN + email */}
                <div style={{
                  padding: '12px 16px', borderBottom: '1px solid var(--color-line-row)',
                  display: 'flex', alignItems: 'center', gap: 10,
                }}>
                  <span className="hdr-sheet-only" style={{
                    width: 34, height: 34, borderRadius: 10, flexShrink: 0,
                    background: T.ink, color: 'var(--color-signal-light)',
                    fontFamily: T.mono, fontWeight: 600, fontSize: 11,
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    {initials}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: T.ink, display: 'flex', alignItems: 'center', gap: 6 }}>
                      {user?.firstName} {user?.lastName}
                      {user?.isAdmin && (
                        <span className="hdr-sheet-only" style={{
                          fontFamily: T.mono, fontWeight: 600, fontSize: 9,
                          letterSpacing: '0.1em', padding: '2px 6px',
                          background: 'var(--color-signal-bg)',
                          border: '1px solid var(--color-signal-border)',
                          borderRadius: 4, color: 'var(--color-signal-link)',
                        }}>
                          ADMIN
                        </span>
                      )}
                    </div>
                    <div style={{ fontFamily: T.mono, fontSize: 10, color: T.ink30, marginTop: 2 }}>
                      {user?.email}
                    </div>
                  </div>
                </div>
                <div style={{ padding: 6 }}>
                  <button
                    onClick={() => { setChangePwModal(true); setMenuOpen(false); }}
                    style={{
                      width: '100%', padding: '9px 10px', fontFamily: T.inter, fontSize: 13,
                      color: T.ink, background: 'none', border: 'none',
                      cursor: 'pointer', textAlign: 'left', borderRadius: 8,
                      transition: 'background .15s',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-line-grid)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                  >
                    Změnit heslo
                  </button>
                  <button
                    onClick={() => { setRulesView(true); setMenuOpen(false); }}
                    style={{
                      width: '100%', padding: '9px 10px', fontFamily: T.inter, fontSize: 13,
                      color: T.ink, background: 'none', border: 'none',
                      cursor: 'pointer', textAlign: 'left', borderRadius: 8,
                      transition: 'background .15s',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-line-grid)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                  >
                    Pravidla používání vozidla
                  </button>
                  {user?.isAdmin && (
                    <button
                      onClick={() => { navigate('/admin/registrace'); setMenuOpen(false); }}
                      style={{
                        width: '100%', padding: '9px 10px', fontFamily: T.inter, fontSize: 13,
                        color: T.ink, background: 'none', border: 'none',
                        cursor: 'pointer', textAlign: 'left', borderRadius: 8,
                        transition: 'background .15s',
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-line-grid)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                    >
                      <span>Čekající registrace</span>
                      {pendingCount > 0 && (
                        <span style={{
                          background: T.signal, color: '#fff',
                          fontFamily: T.mono, fontSize: 10, fontWeight: 600,
                          borderRadius: 9, padding: '0 5px', minWidth: 18, height: 18,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          {pendingCount}
                        </span>
                      )}
                    </button>
                  )}
                  {user?.isAdmin && (
                    <button
                      onClick={() => { navigate('/admin/vozidla'); setMenuOpen(false); }}
                      style={{
                        width: '100%', padding: '9px 10px', fontFamily: T.inter, fontSize: 13,
                        color: T.ink, background: 'none', border: 'none',
                        cursor: 'pointer', textAlign: 'left', borderRadius: 8,
                        transition: 'background .15s',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-line-grid)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                    >
                      Správa vozidel
                    </button>
                  )}
                  {user?.isAdmin && (
                    <button
                      onClick={() => { navigate('/admin/pravidla'); setMenuOpen(false); }}
                      style={{
                        width: '100%', padding: '9px 10px', fontFamily: T.inter, fontSize: 13,
                        color: T.ink, background: 'none', border: 'none',
                        cursor: 'pointer', textAlign: 'left', borderRadius: 8,
                        transition: 'background .15s',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-line-grid)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                    >
                      Úprava pravidel
                    </button>
                  )}
                </div>
                <div style={{ padding: 6, borderTop: '1px solid var(--color-line-row)' }}>
                  <button
                    onClick={() => { logout(); navigate('/login'); }}
                    style={{
                      width: '100%', padding: '9px 10px', fontFamily: T.inter, fontSize: 13,
                      color: 'var(--color-danger)', background: 'none', border: 'none',
                      cursor: 'pointer', textAlign: 'left', borderRadius: 8,
                      transition: 'background .15s',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-danger-bg)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                  >
                    Odhlásit
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ── PAGE CONTENT ────────────────────────────────────────────────────────── */}
      <div className="page-wrap" style={{ maxWidth: 1240, margin: '0 auto', padding: '24px 20px 60px' }}>

        {vehiclesLoading && vehicles.length === 0 ? (
          <div style={{ padding: '64px 20px', textAlign: 'center', fontFamily: T.inter, fontSize: 14, color: T.ink50 }}>
            Načítám vozidla…
          </div>
        ) : vehiclesError && vehicles.length === 0 ? (
          <div style={{ padding: '48px 20px', textAlign: 'center' }}>
            <div style={{ fontFamily: T.sg, fontSize: 15, color: T.danger, marginBottom: 8 }}>
              Nepodařilo se načíst vozidla.
            </div>
            <button
              onClick={fetchVehicles}
              style={{
                fontFamily: T.inter, fontSize: 13, color: T.signal,
                background: 'none', border: `1px solid ${T.line}`, borderRadius: 6,
                cursor: 'pointer', padding: '6px 16px',
              }}
            >
              Zkusit znovu
            </button>
          </div>
        ) : vehicles.length === 0 ? (
          <div style={{ padding: '64px 20px', textAlign: 'center' }}>
            <div style={{ fontFamily: T.sg, fontSize: 18, color: T.ink, marginBottom: 6 }}>
              Žádná vozidla
            </div>
            <div style={{ fontFamily: T.inter, fontSize: 14, color: T.ink50 }}>
              Zatím není k dispozici žádné vozidlo k rezervaci.
            </div>
          </div>
        ) : (
          <>

        {/* ── PŘEPÍNAČ AUT (karty vozidel) ────────────────────────────────────── */}
        <div className="vehicle-cards" style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: 14, marginBottom: 18,
        }}>
          {vehicles.map(v => {
            const active = v.id === selectedVehicleId;
            const stat   = statusOf(v.id, fleetBookings);
            return (
              <button
                key={v.id}
                className="vehicle-card"
                onClick={() => setSelectedVehicleId(v.id)}
                aria-pressed={active}
                style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  textAlign: 'left', padding: '18px 22px',
                  background: active ? T.ink : T.field,
                  border: `1px solid ${active ? T.ink : T.line}`,
                  borderRadius: 14, cursor: 'pointer',
                  color: active ? '#fff' : T.ink,
                  boxShadow: active ? '0 6px 18px rgba(12,27,42,.18)' : 'none',
                  transition: 'background .15s, border-color .15s, box-shadow .15s',
                }}
                onMouseEnter={e => { if (!active) e.currentTarget.style.borderColor = 'var(--color-input)'; }}
                onMouseLeave={e => { if (!active) e.currentTarget.style.borderColor = T.line; }}
              >
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                    <span className="vehicle-card-name" style={{
                      fontFamily: T.sg, fontWeight: 700, fontSize: 17,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      {v.name}
                    </span>
                    {v.plate && (
                      <span className="vehicle-card-plate" style={{
                        fontFamily: T.mono, fontWeight: 500, fontSize: 10,
                        padding: '2px 6px', borderRadius: 4, letterSpacing: '0.05em',
                        border: active ? '1px solid rgba(255,255,255,.25)' : '1px solid var(--color-input)',
                        color: active ? 'rgba(255,255,255,.6)' : T.ink50,
                        whiteSpace: 'nowrap', flexShrink: 0,
                      }}>
                        {v.plate}
                      </span>
                    )}
                  </span>
                  <span className="vehicle-card-status" style={{
                    display: 'flex', alignItems: 'center', gap: 6, marginTop: 6,
                  }}>
                    <span aria-hidden="true" style={{
                      width: 7, height: 7, borderRadius: '50%',
                      background: stat.dot, flexShrink: 0,
                    }} />
                    <span style={{
                      fontSize: 12,
                      color: active ? 'rgba(255,255,255,.65)' : T.ink50,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      {stat.text}
                    </span>
                  </span>
                </span>
                <span className="vehicle-card-badge" style={{
                  fontFamily: T.mono, fontWeight: active ? 600 : 500, fontSize: 10,
                  letterSpacing: '0.12em', flexShrink: 0, marginLeft: 12,
                  color: active ? 'var(--color-signal-light)' : 'var(--color-ink-10)',
                }}>
                  {active ? 'VYBRÁNO' : 'PŘEPNOUT →'}
                </span>
              </button>
            );
          })}
        </div>

        {/* ── MOBILNÍ PÁS DNŮ + AGENDA (≤639px; nahrazuje měsíční mřížku) ──────── */}
        <div className="mob-cal" style={{ marginBottom: 20 }}>
          {/* Pás dnů se šipkami po týdnech */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              onClick={() => setStripWeekOffset(o => o - 1)}
              aria-label="Předchozí týden"
              style={{ ...navBtnStyle, width: 28, height: 44, flexShrink: 0 }}
            >
              ‹
            </button>
            <div style={{ display: 'flex', gap: 6, flex: 1, minWidth: 0 }}>
              {(() => {
                const today  = startOfDay(new Date());
                const monday = addDays(today, -((getDay(today) + 6) % 7) + stripWeekOffset * 7);
                return [...Array(7)].map((_, i) => {
                  const d       = addDays(monday, i);
                  const isSel   = isSameDay(d, selectedDay);
                  const isTod   = isToday(d);
                  return (
                    <button
                      key={i}
                      onClick={() => setSelectedDay(d)}
                      aria-pressed={isSel}
                      style={{
                        flex: 1, minWidth: 0, padding: '8px 0', textAlign: 'center',
                        border: 'none', borderRadius: 10, cursor: 'pointer',
                        background: isSel ? T.signal : (isTod ? 'var(--color-signal-bg)' : 'transparent'),
                        color: isSel ? T.ink : (isTod ? 'var(--color-signal-link)' : T.ink50),
                        boxShadow: isSel ? '0 4px 10px rgba(0,168,214,.3)' : 'none',
                        transition: 'background .15s, box-shadow .15s',
                      }}
                    >
                      <div style={{ fontFamily: T.mono, fontWeight: 500, fontSize: 9, textTransform: 'uppercase' }}>
                        {CS_DAYS_SHORT[i]}
                      </div>
                      <div style={{ fontFamily: T.sg, fontSize: 13, fontWeight: 600, marginTop: 2 }}>
                        {d.getDate()}
                      </div>
                    </button>
                  );
                });
              })()}
            </div>
            <button
              onClick={() => setStripWeekOffset(o => o + 1)}
              aria-label="Následující týden"
              style={{ ...navBtnStyle, width: 28, height: 44, flexShrink: 0 }}
            >
              ›
            </button>
          </div>

          {/* Agenda vybraného dne */}
          <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{
              fontFamily: T.mono, fontWeight: 500, fontSize: 10, color: T.ink30,
              letterSpacing: '0.14em', textTransform: 'uppercase',
            }}>
              {CS_DAYS_SHORT[(getDay(selectedDay) + 6) % 7]} {format(selectedDay, 'dd.MM')} · {selectedVehicle?.name}
            </div>

            {(() => {
              const agendaBookings = bookingsOnDay(selectedDay)
                .slice()
                .sort((a, b) => new Date(a.dateFrom) - new Date(b.dateFrom));
              const agendaPast = isBefore(selectedDay, startOfDay(now)) && !isSameDay(selectedDay, now);
              const freeInfo   = agendaPast ? null : dayFreeInfo(selectedDay, agendaBookings);
              return (
                <>
            {agendaBookings
              .map(b => {
                const mine        = myIds.has(b.id);
                const past        = isPastBooking(b, now);
                const canInteract = !past && (mine || user?.isAdmin);
                const from        = parseISO(b.dateFrom);
                const to          = parseISO(b.dateTo);
                const isFirstDay  = isSameDay(selectedDay, startOfDay(from));
                const multi       = !isSameDay(startOfDay(from), startOfDay(to));
                const fullName    = `${b.user?.firstName ?? ''} ${b.user?.lastName ?? ''}`.trim();
                const dayAb       = d => CS_DAYS_SHORT[(getDay(d) + 6) % 7].toUpperCase();
                const range       = multi
                  ? `${dayAb(from)} ${fmtTime(from)} → ${dayAb(to)} ${fmtTime(to)}`
                  : `${fmtTime(from)} → ${fmtTime(to)}`;
                return (
                  <div key={b.id} style={{ display: 'flex', gap: 12, alignItems: 'stretch' }}>
                    <div style={{
                      fontFamily: T.mono, fontWeight: 600, fontSize: 11,
                      color: mine ? T.signal : T.ink30,
                      width: 40, paddingTop: 12, flexShrink: 0,
                    }}>
                      {isFirstDay ? fmtTime(from) : '0:00'}
                    </div>
                    <button
                      onClick={() => {
                        if (past) setToast({ msg: PAST_MSG });
                        else if (canInteract) openEdit(b);
                        else setToast({ msg: 'Rezervaci může upravit jen autor nebo správce' });
                      }}
                      style={{
                        flex: 1, minWidth: 0, textAlign: 'left',
                        borderRadius: 12, padding: '12px 14px',
                        border: 'none', cursor: 'pointer',
                        color: '#fff',
                        opacity: past ? 0.4 : 1,   // proběhlé rezervace ztlumené
                        background: mine ? T.signal : T.ink,
                      }}
                    >
                      <div style={{ fontFamily: T.sg, fontSize: 13, fontWeight: 700 }}>
                        {fullName}{mine ? ' · vy' : ''}
                      </div>
                      <div style={{
                        fontFamily: T.inter, fontSize: 11, opacity: .8, marginTop: 2,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {range}{b.purpose ? ` · ${b.purpose}` : ''}
                      </div>
                    </button>
                  </div>
                );
              })}

            {/* Volno řádek — jen když v dni reálně zbývá volný čas */}
            {freeInfo && (
              <div style={{ display: 'flex', gap: 12, alignItems: 'stretch' }}>
                <div style={{ width: 40, flexShrink: 0 }} />
                <button
                  onClick={() => openCreate({
                    day:   String(selectedDay.getDate()),
                    month: String(selectedDay.getMonth() + 1),
                    year:  selectedDay.getFullYear(),
                  })}
                  style={{
                    flex: 1, minWidth: 0, textAlign: 'left',
                    border: '1.5px dashed var(--color-ink-10)', borderRadius: 12,
                    padding: '12px 14px', background: 'transparent',
                    color: T.ink30, cursor: 'pointer',
                  }}
                >
                  <div style={{ fontFamily: T.sg, fontSize: 12, fontWeight: 600 }}>
                    {freeInfo.title}
                  </div>
                  <div style={{ fontFamily: T.inter, fontSize: 11, marginTop: 2 }}>
                    ťukněte pro rezervaci
                  </div>
                </button>
              </div>
            )}
                </>
              );
            })()}
          </div>
        </div>

        {/* ── NAV ŘÁDEK KALENDÁŘE ─────────────────────────────────────────────── */}
        <div className="cal-nav" style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 12, marginBottom: 14, flexWrap: 'wrap',
        }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, minWidth: 0 }}>
            <span className="cal-nav-title" style={{
              fontFamily: T.sg, fontSize: 20, fontWeight: 700, color: T.ink,
              letterSpacing: '-0.02em', whiteSpace: 'nowrap',
            }}>
              {selectedVehicle?.name} · {calendarView === 'week'
                ? (isSameDay(weekStart, addDays(startOfDay(new Date()), -((getDay(startOfDay(new Date())) + 6) % 7))) ? 'tento týden' : 'týden')
                : `${CS_MONTHS[currentMonth.getMonth()].toLowerCase()} ${currentMonth.getFullYear()}`}
            </span>
            <span className="cal-nav-range" style={{
              fontFamily: T.mono, fontWeight: 500, fontSize: 12, color: T.ink30,
              whiteSpace: 'nowrap',
            }}>
              {calendarView === 'week'
                ? `${format(weekStart, 'dd.MM')} – ${format(addDays(weekStart, 6), 'dd.MM.yyyy')}`
                : `${format(startOfMonth(currentMonth), 'dd.MM')} – ${format(endOfMonth(currentMonth), 'dd.MM.yyyy')}`}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
            {/* Segmented přepínač pohledu (desktop-only — cal-nav je na mobilu skrytý) */}
            <div style={{
              display: 'flex', border: '1px solid var(--color-input)',
              borderRadius: 8, overflow: 'hidden', marginRight: 6,
              background: T.field,
            }}>
              {[['week', 'Týden'], ['month', 'Měsíc']].map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => changeView(k)}
                  aria-pressed={calendarView === k}
                  style={{
                    fontFamily: T.sg, fontSize: 12, fontWeight: 600,
                    padding: '7px 14px', border: 'none', cursor: 'pointer',
                    background: calendarView === k ? T.ink : T.field,
                    color: calendarView === k ? '#fff' : T.ink50,
                    transition: 'background .15s, color .15s',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              onClick={() => calendarView === 'week'
                ? setWeekStart(w => addDays(w, -7))
                : setCurrentMonth(subMonths(currentMonth, 1))}
              style={navBtnStyle}
              onMouseEnter={e => (e.currentTarget.style.background = T.base)}
              onMouseLeave={e => (e.currentTarget.style.background = T.field)}
              aria-label={calendarView === 'week' ? 'Předchozí týden' : 'Předchozí měsíc'}
            >
              ‹
            </button>
            <button
              onClick={() => {
                if (calendarView === 'week') {
                  const t = startOfDay(new Date());
                  setWeekStart(addDays(t, -((getDay(t) + 6) % 7)));
                } else {
                  setCurrentMonth(startOfMonth(new Date()));
                }
              }}
              style={{ ...navBtnStyle, width: 'auto', padding: '0 14px' }}
              onMouseEnter={e => (e.currentTarget.style.background = T.base)}
              onMouseLeave={e => (e.currentTarget.style.background = T.field)}
            >
              Dnes
            </button>
            <button
              onClick={() => calendarView === 'week'
                ? setWeekStart(w => addDays(w, 7))
                : setCurrentMonth(addMonths(currentMonth, 1))}
              style={navBtnStyle}
              onMouseEnter={e => (e.currentTarget.style.background = T.base)}
              onMouseLeave={e => (e.currentTarget.style.background = T.field)}
              aria-label={calendarView === 'week' ? 'Následující týden' : 'Následující měsíc'}
            >
              ›
            </button>
          </div>
        </div>

        {/* ── TÝDENNÍ PŘEHLED (desktop-only; eventy přijdou ve W2/W3) ──────────── */}
        {calendarView === 'week' && (
          <div className="cal-week-card" style={{
            background: T.field, borderRadius: 12, marginBottom: 20,
            border: `1px solid ${T.line}`,
            overflow: 'hidden',
            opacity: loading ? 0.6 : 1, transition: 'opacity .15s',
          }}>
            {/* Hlavička dnů */}
            <div style={{
              display: 'grid', gridTemplateColumns: '52px repeat(7, 1fr)',
              borderBottom: `1px solid ${T.line}`,
            }}>
              <div />
              {[...Array(7)].map((_, i) => {
                const d     = addDays(weekStart, i);
                const isTod = isToday(d);
                return (
                  <button
                    key={i}
                    onClick={() => setDayDetail(d)}
                    title="Kliknutím zobrazíte souhrn dne"
                    style={{
                      padding: '10px 8px', textAlign: 'center',
                      fontFamily: T.mono, fontWeight: isTod ? 600 : 500, fontSize: 11,
                      color: isTod ? T.signal : T.ink30,
                      background: isTod ? 'var(--color-signal-bg)' : 'transparent',
                      border: 'none',
                      borderLeft: '1px solid var(--color-line-grid)',
                      textTransform: 'uppercase',
                      cursor: 'pointer', transition: 'background .15s',
                    }}
                    onMouseEnter={e => { if (!isTod) e.currentTarget.style.background = T.base; }}
                    onMouseLeave={e => { if (!isTod) e.currentTarget.style.background = 'transparent'; }}
                  >
                    {CS_DAYS_SHORT[i]} {d.getDate()}
                  </button>
                );
              })}
            </div>

            {/* Tělo: 24 h × 22 px */}
            <div style={{ display: 'grid', gridTemplateColumns: '52px repeat(7, 1fr)', height: 24 * HOUR_PX }}>
              {/* Osa hodin */}
              <div style={{ position: 'relative', fontFamily: T.mono, fontSize: 10, color: 'var(--color-ink-20)' }}>
                {Array.from({ length: 23 }, (_, i) => i + 1).map(h => (
                  <span key={h} style={{ position: 'absolute', top: h * HOUR_PX - 6, right: 8 }}>
                    {h}:00
                  </span>
                ))}
              </div>
              {/* Sloupce dnů (hodinové linky přes CSS gradient) */}
              {[...Array(7)].map((_, i) => {
                const d     = addDays(weekStart, i);
                const isTod = isToday(d);
                return (
                  <div
                    key={i}
                    onClick={e => {
                      // klik na prázdný slot → nová rezervace s prefillem dne + hodiny z pozice
                      const rect = e.currentTarget.getBoundingClientRect();
                      const hour = Math.min(23, Math.max(0, Math.floor((e.clientY - rect.top) / HOUR_PX)));
                      openCreate({
                        day:   String(d.getDate()),
                        month: String(d.getMonth() + 1),
                        year:  d.getFullYear(),
                        hour,
                      });
                    }}
                    title="Kliknutím vytvoříte rezervaci na tento den"
                    style={{
                      position: 'relative', cursor: 'pointer',
                      borderLeft: '1px solid var(--color-line-grid)',
                      background: isTod
                        ? `linear-gradient(rgba(0,168,214,.10) 1px, transparent 1px) 0 ${HOUR_PX}px / 100% ${HOUR_PX}px var(--color-signal-bg)`
                        : `linear-gradient(var(--color-line-grid) 1px, transparent 1px) 0 ${HOUR_PX}px / 100% ${HOUR_PX}px`,
                    }}
                  >
                    {/* Rezervace dne — jednodenní bloky + vícedenní denní segmenty
                        (varianta C: flush vnitřní hrany propojují segmenty přes
                        sloupce, gradient + 3px horní linka + šipka › na pokračování).
                        Obsah degraduje podle výšky (< 20 px proužek s tooltippem). */}
                    {bookingsOnDay(d).map(b => {
                      const mine        = myIds.has(b.id);
                      const past        = isPastBooking(b, now);
                      const canInteract = !past && (mine || user?.isAdmin);
                      const from        = parseISO(b.dateFrom);
                      const to          = parseISO(b.dateTo);
                      const first       = isSameDay(d, startOfDay(from));
                      const last        = isSameDay(d, startOfDay(to));
                      const single      = first && last;

                      // segment dne: první den od startu, poslední do konce, jinak 0–24
                      const segStart = first ? from.getHours() + from.getMinutes() / 60 : 0;
                      const segEnd   = last  ? to.getHours()   + to.getMinutes()   / 60 : 24;
                      const { top, height } = weekBlockGeometry(segStart, segEnd);

                      const showTime = height >= 20;
                      const showName = height >= 34;
                      const fullName = `${b.user?.firstName ?? ''} ${b.user?.lastName ?? ''}`.trim();
                      const surname  = b.user?.lastName ?? '';
                      const dayAb    = dd => CS_DAYS_SHORT[(getDay(dd) + 6) % 7].toUpperCase();
                      const cont     = !single && !last; // pokračuje do dalšího dne

                      // texty per segment
                      const timeText = single
                        ? `${fmtTime(from)}–${fmtTime(to)}`
                        : first
                          ? `${fmtTime(from)} → ${dayAb(to)} ${fmtTime(to)}`
                          : last
                            ? `→ do ${fmtTime(to)}`
                            : '→ celý den →';
                      const whoText = single || first
                        ? `${fullName}${mine ? ' · vy' : ''}`
                        : `${surname} · do ${dayAb(to)} ${fmtTime(to)}`;

                      return (
                        <div
                          key={b.id}
                          onClick={e => {
                            e.stopPropagation();
                            if (past) setToast({ msg: PAST_MSG });
                            else if (canInteract) openEdit(b);
                            else setToast({ msg: 'Rezervaci může upravit jen autor nebo správce' });
                          }}
                          title={`${fullName} · ${fmtRange(b.dateFrom, b.dateTo)}`}
                          style={{
                            opacity: past ? 0.4 : 1,   // proběhlé rezervace ztlumené
                            position: 'absolute',
                            left: first ? 4 : 0, right: last ? 4 : 0,
                            top, height,
                            borderRadius: single
                              ? (height < 12 ? 3 : 6)
                              : `${first ? 6 : 0}px ${last ? 6 : 0}px ${last ? 6 : 0}px ${first ? 6 : 0}px`,
                            background: single
                              ? (mine ? T.signal : T.ink)
                              : (mine
                                ? 'linear-gradient(180deg, #2BBCE4, #00A8D6)'
                                : 'linear-gradient(180deg, #1A3A5C, #0C1B2A)'),
                            boxShadow: single
                              ? 'none'
                              : `inset 0 3px 0 ${mine ? 'var(--color-signal-deep)' : 'var(--color-signal-light)'}`,
                            color: '#fff',
                            padding: showTime ? (single ? '3px 8px' : `6px ${cont ? 24 : 8}px 3px 8px`) : 0,
                            boxSizing: 'border-box', overflow: 'hidden',
                            cursor: 'pointer', userSelect: 'none',
                          }}
                        >
                          {showTime && (
                            <div style={{ fontFamily: T.mono, fontWeight: 600, fontSize: 10, color: '#fff' }}>
                              {timeText}
                            </div>
                          )}
                          {showName && (
                            <div style={{
                              fontFamily: T.inter, fontSize: 11, fontWeight: 500, marginTop: 1,
                              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                            }}>
                              {whoText}
                            </div>
                          )}
                          {cont && (
                            <span aria-hidden="true" style={{
                              position: 'absolute', right: 5, top: '50%',
                              transform: 'translateY(-50%)',
                              width: 16, height: 16, borderRadius: '50%',
                              background: 'var(--color-signal-light)',
                              color: 'var(--color-signal-deep)',
                              fontSize: 10, fontWeight: 700,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}>
                              ›
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── MĚSÍČNÍ PŘEHLED (desktop; na mobilu ho nahrazuje agenda) ─────────── */}
        {calendarView === 'month' && (
        <div className="cal-month-card" style={{
          background: T.field, borderRadius: 12, marginBottom: 20,
          border: `1px solid ${T.line}`,
          overflow: 'hidden',
          opacity: loading ? 0.6 : 1, transition: 'opacity .15s',
        }}>
          {/* Day-of-week headers */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)',
            borderBottom: `1px solid ${T.line}`,
          }}>
            {CS_DAYS_SHORT.map(d => (
              <div key={d} className="cal-dow" style={{
                textAlign: 'center', padding: '10px 8px',
                fontFamily: T.mono, fontSize: 10, fontWeight: 500,
                color: T.ink30, textTransform: 'uppercase', letterSpacing: '0.05em',
              }}>
                {d}
              </div>
            ))}
          </div>

          {/* Day grid — pevných 528px jako týdenní tělo (buňky se dělí rovnoměrně
              podle počtu řádků měsíce: 4/5/6), ať přepínání pohledů neposkakuje */}
          <div
            style={{
              display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)',
              gridAutoRows: '1fr', height: 528,
            }}
            onTouchStart={handleCalTouchStart}
            onTouchEnd={handleCalTouchEnd}
          >
            {[...grid, ...Array((7 - (grid.length % 7)) % 7).fill(null)].map((day, i) => {
              const isNull    = day === null;
              const inPast    = day && isBefore(day, startOfDay(now)) && !isToday(day);
              const isCurrentDay = day && isToday(day);
              const isCurrentMonth = day && day.getMonth() === currentMonth.getMonth();

              const colLine = '1px solid var(--color-line-grid)';
              const cellBg  = isNull
                ? 'var(--color-input-bg)'
                : (isCurrentDay ? 'var(--color-signal-bg)' : T.field);

              return (
                <div
                  key={i}
                  onClick={() => { if (!day || isNull) return; setDayDetail(day); }}
                  className="cal-cell"
                  style={{
                    minHeight: 62, padding: 6,
                    background: cellBg,
                    borderRight:  (i % 7 !== 6) ? colLine : 'none',
                    borderBottom: colLine,
                    cursor: !isNull ? 'pointer' : 'default',
                    transition: 'background .1s',
                    boxSizing: 'border-box',
                    overflow: 'hidden',
                  }}
                  onMouseEnter={e => { if (!isNull && !isCurrentDay) e.currentTarget.style.background = T.base; }}
                  onMouseLeave={e => { if (!isNull) e.currentTarget.style.background = cellBg; }}
                >
                  {day && (
                    <>
                      {/* Day number */}
                      {isCurrentDay ? (
                        <div style={{
                          width: 20, height: 20, borderRadius: 6,
                          background: T.signal, color: T.ink,
                          fontFamily: T.sg, fontSize: 11, fontWeight: 700,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          {format(day, 'd')}
                        </div>
                      ) : (
                        <div style={{
                          fontFamily: T.sg, fontSize: 11, fontWeight: 600,
                          color: inPast ? T.ink30 : (isCurrentMonth ? T.ink : T.ink30),
                        }}>
                          {format(day, 'd')}
                        </div>
                      )}
                      <CellBookings day={day} />
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        )}

        {/* ── ACTION BAR (nová rezervace; desktop — na mobilu ho nahrazuje fixní CTA sheet) ── */}
        <div className="action-bar" style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 10, background: T.field, border: `1px solid ${T.line}`,
          borderRadius: 10, padding: '10px 10px 10px 16px', marginBottom: 20,
        }}>
          <span className="action-bar-hint" style={{ fontSize: 12.5, color: T.ink30 }}>
            Klikněte na den v kalendáři, nebo vytvořte rezervaci formulářem.
          </span>
          <button
            onClick={() => openCreate()}
            style={{
              padding: '10px 20px', background: T.signal,
              border: 'none', borderRadius: 8, cursor: 'pointer',
              fontFamily: T.sg, fontSize: 13, fontWeight: 700,
              color: 'var(--color-signal-deep)', whiteSpace: 'nowrap',
              transition: 'background .15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-signal-hover)')}
            onMouseLeave={e => (e.currentTarget.style.background = T.signal)}
          >
            + Nová rezervace
          </button>
        </div>

        {/* ── KNIHA REZERVACÍ ─────────────────────────────────────────────────── */}
        <div className="kniha-card" style={{
          background: T.field, borderRadius: 12,
          border: `1px solid ${T.line}`,
          padding: '16px 20px',
        }}>
          {/* Header */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          }}>
            <span style={{
              fontFamily: T.mono, fontWeight: 500, fontSize: 10, color: T.ink30,
              letterSpacing: '0.14em', textTransform: 'uppercase',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              Kniha rezervací · {selectedVehicle?.name}
            </span>
            <div style={{
              display: 'flex', border: '1px solid var(--color-input)',
              borderRadius: 6, overflow: 'hidden', flexShrink: 0,
            }}>
              {[['all','Vše'],['mine','Moje']].map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setBookFilter(k)}
                  aria-pressed={bookFilter === k}
                  style={{
                    fontFamily: T.inter, fontSize: 10, fontWeight: 600,
                    color: bookFilter === k ? '#fff' : T.ink50,
                    background: bookFilter === k ? T.ink : T.field,
                    border: 'none', cursor: 'pointer',
                    padding: '4px 10px',
                    transition: 'color .15s, background .15s',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Rows */}
          {loading ? (
            <div style={{ padding: '24px 0', textAlign: 'center', color: T.ink30, fontFamily: T.inter, fontSize: 13 }}>
              Načítám rezervace...
            </div>
          ) : loadError ? (
            <div style={{ padding: '24px 0', textAlign: 'center' }}>
              <div style={{ fontFamily: T.sg, fontSize: 14, color: T.danger, marginBottom: 8 }}>
                Nepodařilo se načíst rezervace.
              </div>
              <button
                onClick={fetchAll}
                style={{
                  fontFamily: T.inter, fontSize: 13, color: 'var(--color-signal-link)',
                  background: 'none', border: '1px solid var(--color-input)', borderRadius: 8,
                  cursor: 'pointer', padding: '6px 16px',
                  transition: 'background .15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = T.base)}
                onMouseLeave={e => (e.currentTarget.style.background = 'none')}
              >
                Zkusit znovu
              </button>
            </div>
          ) : agendaList.length === 0 ? (
            <div style={{ padding: '16px 0 8px', fontSize: 12, color: T.ink30, fontFamily: T.inter }}>
              Žádné rezervace.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {agendaList.map((b, i) => {
                const mine      = myIds.has(b.id);
                const canEdit   = mine || user?.isAdmin;
                const canDelete = mine || user?.isAdmin;
                const bName     = `${b.user?.firstName ?? ''} ${b.user?.lastName ?? ''}`.trim();
                const isLast    = i === agendaList.length - 1;

                return (
                  <div
                    key={b.id}
                    className="agenda-row"
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      gap: 12, padding: '9px 0',
                      borderBottom: isLast ? 'none' : '1px solid var(--color-line-row)',
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div className="kniha-time" style={{
                        fontFamily: T.mono, fontWeight: 600, fontSize: 12,
                        color: mine ? T.signal : T.ink,
                      }}>
                        {fmtKniha(b.dateFrom, b.dateTo)}
                      </div>
                      <div className="kniha-sub" style={{
                        fontFamily: T.inter, fontSize: 12, color: T.ink50, marginTop: 2,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {bName}{mine ? ' (vy)' : ''}{b.purpose ? ` · ${b.purpose}` : ''}
                      </div>
                    </div>

                    {(canEdit || canDelete) && (
                      <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexShrink: 0 }}>
                        {canEdit && (
                          <button
                            onClick={() => openEdit(b)}
                            className="agenda-link"
                            style={{
                              fontFamily: T.inter, fontSize: 11, fontWeight: 600,
                              color: 'var(--color-signal-link)',
                              background: 'none', border: 'none', cursor: 'pointer',
                              padding: '6px 2px',
                            }}
                            onMouseEnter={e => (e.currentTarget.style.textDecoration = 'underline')}
                            onMouseLeave={e => (e.currentTarget.style.textDecoration = 'none')}
                          >
                            Upravit
                          </button>
                        )}
                        {canDelete && (
                          <button
                            onClick={() => setDeleteTarget(b)}
                            className="agenda-link"
                            style={{
                              fontFamily: T.inter, fontSize: 11, fontWeight: 400,
                              color: 'var(--color-danger)',
                              background: 'none', border: 'none', cursor: 'pointer',
                              padding: '6px 2px',
                            }}
                            onMouseEnter={e => (e.currentTarget.style.textDecoration = 'underline')}
                            onMouseLeave={e => (e.currentTarget.style.textDecoration = 'none')}
                          >
                            Zrušit
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── FIXNÍ CTA SHEET (≤639px; nahrazuje action bar) ──────────────────── */}
        <div className="mob-cta-sheet" style={{
          background: T.field,
          borderRadius: '20px 20px 0 0',
          boxShadow: '0 -8px 30px rgba(12,27,42,.12)',
          padding: '12px 16px calc(18px + env(safe-area-inset-bottom))',
        }}>
          <div style={{
            width: 36, height: 4, borderRadius: 2,
            background: T.line, margin: '0 auto 12px',
          }} />
          <button
            onClick={() => openCreate()}
            style={{
              width: '100%', height: 52,
              background: T.signal, color: 'var(--color-signal-deep)',
              fontFamily: T.sg, fontSize: 15, fontWeight: 700,
              border: 'none', borderRadius: 12, cursor: 'pointer',
              transition: 'background .15s',
            }}
          >
            + Nová rezervace · {selectedVehicle?.name}
          </button>
        </div>

          </>
        )}
      </div>

      {/* ── DAY DETAIL MODAL ─────────────────────────────────────────────────── */}
      {dayDetail && (
        <ModalCard
          width={420}
          zIndex={40}
          title={fmtDayHeading(dayDetail)}
          titleStyle={{ textTransform: 'capitalize' }}
          onClose={() => setDayDetail(null)}
        >
            <div style={{
              fontFamily: T.mono, fontWeight: 500, fontSize: 10, color: T.ink30,
              letterSpacing: '0.12em', textTransform: 'uppercase', marginTop: 4,
              flexShrink: 0,
            }}>
              {selectedVehicle?.name}
            </div>

            {/* Booking list */}
            <div style={{ overflowY: 'auto', flex: 1, marginTop: 12 }}>
              {dayBookings.length === 0 ? (
                <p style={{
                  fontFamily: T.inter, fontSize: 12.5, color: T.ink30,
                  textAlign: 'center', padding: '14px 0', margin: 0,
                }}>
                  {inPastDay ? 'Žádné rezervace tento den.' : 'Zatím žádné rezervace. Přidejte svou!'}
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {dayBookings.map((b, i) => {
                    const mine      = myIds.has(b.id);
                    const past      = isPastBooking(b, now);
                    // proběhlou rezervaci nelze upravit (backend chce budoucí datum),
                    // smazat ji ale jde — správce tak může uklidit historii
                    const canEdit   = !past && (mine || user?.isAdmin);
                    const canDelete = mine || user?.isAdmin;
                    const fullName  = `${b.user?.firstName ?? ''} ${b.user?.lastName ?? ''}`.trim();
                    const isLast    = i === dayBookings.length - 1;
                    return (
                      <div
                        key={b.id}
                        style={{
                          padding: '9px 0',
                          borderBottom: isLast ? 'none' : '1px solid var(--color-line-row)',
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                          opacity: past ? 0.55 : 1,
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div style={{
                            fontFamily: T.mono, fontWeight: 600, fontSize: 12,
                            color: mine ? T.signal : T.ink,
                          }}>
                            {fmtRange(b.dateFrom, b.dateTo)}
                          </div>
                          <div style={{
                            fontFamily: T.inter, fontSize: 12, color: T.ink50, marginTop: 2,
                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                          }}>
                            {fullName}{mine ? ' (vy)' : ''}{b.purpose ? ` · ${b.purpose}` : ''}
                          </div>
                        </div>
                        {(canEdit || canDelete) && (
                          <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexShrink: 0 }}>
                            {canEdit && (
                              <button
                                onClick={() => openEdit(b)}
                                style={{
                                  fontFamily: T.inter, fontSize: 11, fontWeight: 600,
                                  color: 'var(--color-signal-link)',
                                  background: 'none', border: 'none', cursor: 'pointer',
                                  padding: '6px 2px',
                                }}
                                onMouseEnter={e => (e.currentTarget.style.textDecoration = 'underline')}
                                onMouseLeave={e => (e.currentTarget.style.textDecoration = 'none')}
                              >Upravit</button>
                            )}
                            {canDelete && (
                              <button
                                onClick={() => setDeleteTarget(b)}
                                style={{
                                  fontFamily: T.inter, fontSize: 11, fontWeight: 400,
                                  color: 'var(--color-danger)',
                                  background: 'none', border: 'none', cursor: 'pointer',
                                  padding: '6px 2px',
                                }}
                                onMouseEnter={e => (e.currentTarget.style.textDecoration = 'underline')}
                                onMouseLeave={e => (e.currentTarget.style.textDecoration = 'none')}
                              >Zrušit</button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Footer */}
            {!inPastDay && (
              <div style={{ marginTop: 14, flexShrink: 0 }}>
                <button
                  onClick={() => openCreate({
                    day:   String(dayDetail.getDate()),
                    month: String(dayDetail.getMonth() + 1),
                    year:  dayDetail.getFullYear(),
                  })}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--color-signal-hover)'}
                  onMouseLeave={e => e.currentTarget.style.background = T.signal}
                  style={{
                    width: '100%', height: 46,
                    background: T.signal, color: 'var(--color-signal-deep)',
                    fontFamily: T.sg, fontWeight: 700, fontSize: 13,
                    border: 'none', borderRadius: 10, cursor: 'pointer',
                    transition: 'background .15s',
                  }}
                >
                  + Rezervovat na tento den
                </button>
              </div>
            )}
        </ModalCard>
      )}

      {/* ── CHANGE PASSWORD MODAL ────────────────────────────────────────────── */}
      {changePwModal && (
        <ModalCard
          width={340}
          title="Změnit heslo"
          onClose={() => { setChangePwModal(false); setChangePwError(''); }}
          cardStyle={{ padding: '24px 24px 22px', overflowY: 'auto' }}
        >
            <form onSubmit={handleChangePw} style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[
                { key: 'current',  label: 'Současné heslo',        auto: 'current-password' },
                { key: 'newPw',    label: 'Nové heslo',             auto: 'new-password', hint: 'min. 8 znaků' },
                { key: 'confirm',  label: 'Potvrzení nového hesla', auto: 'new-password' },
              ].map(({ key, label, auto, hint }) => (
                <div key={key}>
                  <label style={monoLabelStyle}>
                    {label}
                    {hint && <span style={monoLabelHintStyle}> · {hint}</span>}
                  </label>
                  <div style={{ position: 'relative' }}>
                    <input
                      type={showPw[key] ? 'text' : 'password'}
                      value={changePwForm[key]}
                      onChange={e => setChangePwForm(f => ({ ...f, [key]: e.target.value }))}
                      required
                      autoComplete={auto}
                      placeholder="••••••••"
                      style={pwInputStyle}
                      onFocus={e  => (e.target.style.borderColor = T.signal)}
                      onBlur={e   => (e.target.style.borderColor = 'var(--color-input)')}
                    />
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => setShowPw(s => ({ ...s, [key]: !s[key] }))}
                      aria-label={showPw[key] ? 'Skrýt heslo' : 'Zobrazit heslo'}
                      style={eyeBtnStyle}
                    >
                      <EyeIcon visible={showPw[key]} />
                    </button>
                  </div>
                </div>
              ))}

              {changePwError && (
                <div style={{
                  fontFamily: T.inter, fontSize: 13, color: T.danger,
                  background: 'var(--color-danger-bg)', border: '1px solid var(--color-danger-border)',
                  borderRadius: 8, padding: '8px 12px',
                }}>
                  {changePwError}
                </div>
              )}

              <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
                <button
                  type="button"
                  onClick={() => { setChangePwModal(false); setChangePwError(''); }}
                  style={modalBtn()}
                  onMouseEnter={e => (e.currentTarget.style.background = T.base)}
                  onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                >
                  Zrušit
                </button>
                <button
                  type="submit"
                  disabled={changePwLoading}
                  style={{
                    ...modalBtn('navy'),
                    cursor: changePwLoading ? 'wait' : 'pointer',
                    opacity: changePwLoading ? 0.7 : 1,
                  }}
                  onMouseEnter={e => { if (!changePwLoading) e.currentTarget.style.background = 'var(--color-ink-hover)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = T.ink; }}
                >
                  {changePwLoading ? 'Ukládám...' : 'Uložit nové heslo'}
                </button>
              </div>
            </form>
        </ModalCard>
      )}

      {/* ── BOOKING MODAL (Nová/Upravit rezervace) ───────────────────────────── */}
      {modalOpen && (
        <ModalCard
          width={420}
          title={`${isEdit ? 'Upravit rezervaci' : 'Nová rezervace'} · ${selectedVehicle?.name ?? ''}`}
          onClose={() => setModal(null)}
          cardStyle={{ overflowY: 'auto' }}
        >
            {isEdit && modal.booking && !myIds.has(modal.booking.id) && user?.isAdmin && (
              <div style={{
                fontFamily: T.inter, fontSize: 12, color: T.ink50,
                background: 'var(--color-line-grid)', borderRadius: 8,
                padding: '8px 12px', marginTop: 12,
              }}>
                Rezervace uživatele:{' '}
                <strong style={{ color: T.ink }}>
                  {modal.booking.user?.firstName} {modal.booking.user?.lastName}
                </strong>
              </div>
            )}

            <form onSubmit={handleSubmit} style={{ marginTop: 16 }}>
              {/* FROM — u probíhající rezervace zamčené (začátek už proběhl) */}
              <div style={{ marginBottom: 12 }}>
                <label style={monoLabelStyle}>
                  Od
                  {editingRunning && (
                    <span style={{ ...monoLabelHintStyle, marginLeft: 6 }}>· už probíhá, nelze měnit</span>
                  )}
                </label>
                <DateTimeGroup prefix="from" form={mForm} setF={setF} disabled={editingRunning} />
                {editingRunning && (
                  <div style={{ fontFamily: T.inter, fontSize: 12, color: T.ink30, marginTop: 6, lineHeight: 1.45 }}>
                    Rezervace už běží — upravit jde jen konec (prodloužit nebo zkrátit).
                  </div>
                )}
              </div>

              {/* TO */}
              <div style={{ marginBottom: 12 }}>
                <label style={monoLabelStyle}>Do</label>
                <DateTimeGroup prefix="to" form={mForm} setF={setF} />
              </div>

              {/* Purpose */}
              <div style={{ marginBottom: 12 }}>
                <label style={monoLabelStyle}>
                  Účel cesty
                  <span style={monoLabelHintStyle}> {mForm.purpose.length}/200</span>
                </label>
                <textarea
                  value={mForm.purpose}
                  onChange={e => setF('purpose', e.target.value.slice(0, 200))}
                  rows={3}
                  placeholder="Popište účel jízdy…"
                  required
                  style={{
                    width: '100%', boxSizing: 'border-box', minHeight: 72,
                    border: '1px solid var(--color-input)', borderRadius: 10,
                    background: 'var(--color-input-bg)',
                    fontFamily: T.inter, fontSize: 13, color: T.ink,
                    padding: '10px 12px', resize: 'none', outline: 'none',
                    transition: 'border-color .15s',
                  }}
                  onFocus={e  => (e.target.style.borderColor = T.signal)}
                  onBlur={e   => (e.target.style.borderColor = 'var(--color-input)')}
                />
              </div>

              {mError && (
                <div style={{
                  fontFamily: T.inter, fontSize: 13, color: T.danger,
                  background: 'var(--color-danger-bg)', border: '1px solid var(--color-danger-border)',
                  borderRadius: 8, padding: '8px 12px', marginBottom: 12,
                }}>
                  {mError}
                </div>
              )}

              <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                {isEdit && (
                  <button
                    type="button"
                    onClick={() => { setDeleteTarget(modal.booking); setModal(null); }}
                    style={{
                      flex: 'none', height: 44, padding: '0 14px',
                      background: 'var(--color-danger-bg)',
                      border: '1px solid var(--color-danger-border)',
                      borderRadius: 10, cursor: 'pointer',
                      fontFamily: T.sg, fontSize: 13, fontWeight: 600,
                      color: T.danger, transition: 'background .15s',
                    }}
                  >
                    Smazat
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setModal(null)}
                  style={modalBtn()}
                  onMouseEnter={e => (e.currentTarget.style.background = T.base)}
                  onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                >
                  Zrušit
                </button>
                <button
                  type="submit"
                  disabled={mLoading}
                  style={{
                    ...modalBtn('signal'),
                    cursor: mLoading ? 'wait' : 'pointer',
                    opacity: mLoading ? 0.7 : 1,
                  }}
                  onMouseEnter={e => { if (!mLoading) e.currentTarget.style.background = 'var(--color-signal-hover)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = T.signal; }}
                >
                  {mLoading ? 'Ukládám...' : (isEdit ? 'Uložit změny' : 'Uložit rezervaci')}
                </button>
              </div>
            </form>
        </ModalCard>
      )}

      {/* ── TOAST ────────────────────────────────────────────────────────────── */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'fixed', bottom: 26, left: '50%',
            transform: 'translateX(-50%)', zIndex: 80,
            background: toast.variant === 'danger' ? T.danger : T.ink,
            color: '#fff',
            fontFamily: T.sg, fontWeight: 600, fontSize: 13,
            padding: '11px 20px', borderRadius: 12,
            boxShadow: '0 10px 30px rgba(12,27,42,.35)',
            animation: 'toast-in .25s ease',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          {toast.msg}
        </div>
      )}

      {/* ── DELETE MODAL (Zrušit rezervaci?) ─────────────────────────────────── */}
      {deleteTarget && (
        <ModalCard
          width={320}
          title="Zrušit rezervaci?"
          onClose={() => { setDeleteTarget(null); setDeleteError(''); }}
        >
            {/* Červený souhrn rušené rezervace */}
            <div style={{
              marginTop: 12, padding: '12px 14px',
              background: 'var(--color-danger-bg)',
              border: '1px solid var(--color-danger-border)',
              borderRadius: 10,
            }}>
              <div style={{ fontFamily: T.mono, fontWeight: 600, fontSize: 12, color: T.danger }}>
                {fmtRange(deleteTarget.dateFrom, deleteTarget.dateTo)}
              </div>
              <div style={{
                fontFamily: T.inter, fontSize: 12, color: T.ink50, marginTop: 3,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {[
                  selectedVehicle?.name,
                  `${deleteTarget.user?.firstName ?? ''} ${deleteTarget.user?.lastName ?? ''}`.trim(),
                  deleteTarget.purpose,
                ].filter(Boolean).join(' · ')}
              </div>
            </div>

            <div style={{ marginTop: 10, fontFamily: T.inter, fontSize: 12, lineHeight: 1.5, color: T.ink30 }}>
              Tuto akci nelze vrátit zpět.
            </div>

            {deleteError && (
              <p style={{
                fontFamily: T.inter, fontSize: 13, color: T.danger,
                background: 'var(--color-danger-bg)', border: '1px solid var(--color-danger-border)',
                borderRadius: 8, padding: '8px 12px', margin: '12px 0 0',
              }}>
                {deleteError}
              </p>
            )}

            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button
                onClick={() => { setDeleteTarget(null); setDeleteError(''); }}
                style={modalBtn()}
                onMouseEnter={e => (e.currentTarget.style.background = T.base)}
                onMouseLeave={e => (e.currentTarget.style.background = 'none')}
              >
                Zpět
              </button>
              <button
                onClick={handleDelete}
                style={modalBtn('danger')}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-danger-hover)')}
                onMouseLeave={e => (e.currentTarget.style.background = T.danger)}
              >
                Zrušit rezervaci
              </button>
            </div>
        </ModalCard>
      )}

      {/* ── PRAVIDLA POUŽÍVÁNÍ VOZIDLA ───────────────────────────────────────── */}
      {rulesGate && (
        <RulesModal
          mode="accept"
          sections={rules?.sections}
          confirming={rulesSaving}
          error={rulesError}
          onConfirm={handleAcceptRules}
          onClose={() => { logout(); navigate('/login'); }}
        />
      )}
      {rulesView && (
        <RulesModal mode="view" sections={rules?.sections} onClose={() => setRulesView(false)} />
      )}

      <style>{`
        /* ── header responsive ─────────────────────────────────────────────── */
        .hdr-sheet-only   { display: none !important; }
        .hdr-menu-overlay { display: none; }
        @media (max-width: 639px) {
          .hdr-subtitle { display: none !important; }
          .hdr-clock    { display: none !important; }
          .hdr-uname    { display: none !important; }
          .hdr-uadmin   { display: none !important; }

          /* pill → samotný avatar */
          .hdr-pill   { background: transparent !important; border: none !important; padding: 0 !important; }
          .hdr-avatar { width: 34px !important; height: 34px !important; border-radius: 10px !important; font-size: 11px !important; }
          .hdr-chev   { display: none !important; }

          /* dropdown → bottom sheet */
          .hdr-menu-overlay {
            display: block;
            position: fixed; inset: 0;
            background: rgba(12,27,42,.4);
            z-index: 120;
          }
          .hdr-menu {
            position: fixed !important;
            top: auto !important; bottom: 0 !important;
            left: 0 !important; right: 0 !important;
            width: auto !important; max-width: none !important;
            border: none !important;
            border-radius: 20px 20px 0 0 !important;
            box-shadow: 0 -8px 30px rgba(12,27,42,.12) !important;
            z-index: 130 !important;
            padding-bottom: 14px;
          }
          .hdr-menu button { padding: 13px 10px !important; font-size: 14px !important; }
          .hdr-sheet-only  { display: flex !important; }
        }

        /* ── calendar responsive: mobil = pás dnů + agenda, mřížka skrytá ───── */
        .mob-cal { display: none; }
        @media (max-width: 639px) {
          .mob-cal        { display: block; }
          .cal-nav        { display: none !important; }
          .cal-month-card { display: none !important; }
          .cal-week-card  { display: none !important; }
        }

        /* ── agenda responsive ─────────────────────────────────────────────── */
        @media (max-width: 639px) {
          .agenda-row  { min-height: 56px; }
          .agenda-link { padding: 12px 6px !important; }
        }

        /* ── page wrapper ──────────────────────────────────────────────────── */
        @media (max-width: 639px) {
          /* spodní padding kryje fixní CTA sheet, ať nepřekrývá knihu */
          .page-wrap { padding: 16px 12px 140px !important; }
        }

        /* ── fixní CTA sheet + action bar (mobil) ──────────────────────────── */
        .mob-cta-sheet { display: none; }
        @media (max-width: 639px) {
          .mob-cta-sheet {
            display: block;
            position: fixed; bottom: 0; left: 0; right: 0;
            z-index: 30;
          }
          .action-bar { display: none !important; }
        }

        /* ── kniha kompakt (mobil) ─────────────────────────────────────────── */
        @media (max-width: 639px) {
          .kniha-card { padding: 8px 14px !important; }
          .kniha-time { font-size: 11px !important; }
          .kniha-sub  { font-size: 11px !important; }
        }

        /* ── vehicle cards responsive ──────────────────────────────────────── */
        @media (max-width: 639px) {
          .vehicle-cards {
            display: flex !important;
            overflow-x: auto;
            padding-bottom: 2px;
          }
          .vehicle-card {
            flex: 1 0 auto;
            min-width: 168px;
            max-width: 260px;
            padding: 12px 14px !important;
            border-radius: 12px !important;
          }
          .vehicle-card-name   { font-size: 14px !important; }
          .vehicle-card-plate  { display: none !important; }
          .vehicle-card-badge  { display: none !important; }
          .vehicle-card-status span:last-child { font-size: 10px !important; text-transform: lowercase; }
        }
        .vehicle-cards::-webkit-scrollbar { height: 4px; }
        .vehicle-cards::-webkit-scrollbar-thumb { background: ${T.line}; border-radius: 2px; }

        /* ── modal: centered on all screen sizes ───────────────────────────── */
        .md-modal { border-radius: 12px; }

        @keyframes toast-in {
          from { opacity: 0; transform: translate(-50%, 10px); }
          to   { opacity: 1; transform: translate(-50%, 0); }
        }

        @media (prefers-reduced-motion: reduce) {
          * { transition: none !important; animation-duration: 0.01ms !important; }
        }
      `}</style>
    </div>
  );
}

// ── modal shell (sdílený vzhled modálů dle handoffu) ─────────────────────────

const modalOverlayStyle = {
  position: 'fixed', inset: 0,
  background: 'rgba(12,27,42,.45)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: 16,
};

const monoLabelStyle = {
  display: 'block',
  fontFamily: 'var(--font-mono)', fontWeight: 500, fontSize: 10,
  color: 'var(--color-ink-50)', textTransform: 'uppercase',
  letterSpacing: '0.12em', marginBottom: 6,
};

// Nenápadný dovětek štítku (např. „· min. 8 znaků")
const monoLabelHintStyle = {
  color: 'var(--color-ink-10)', letterSpacing: 0, textTransform: 'none',
};

// Tlačítka v patě modalu: 'outline' | 'signal' | 'navy' | 'danger'
function modalBtn(variant = 'outline') {
  const base = {
    flex: 1, height: 44, borderRadius: 10, cursor: 'pointer',
    fontFamily: "'Space Grotesk', system-ui, sans-serif",
    fontSize: 13, fontWeight: 600, border: 'none',
    transition: 'background .15s, opacity .15s',
  };
  switch (variant) {
    case 'signal':
      return { ...base, flex: 1.4, fontWeight: 700, background: 'var(--color-signal)', color: 'var(--color-signal-deep)' };
    case 'navy':
      return { ...base, flex: 1.4, fontWeight: 700, background: 'var(--color-ink)', color: '#fff' };
    case 'danger':
      return { ...base, flex: 1.3, fontWeight: 700, background: 'var(--color-danger)', color: '#fff' };
    default:
      return { ...base, background: 'none', border: '1px solid var(--color-input)', color: 'var(--color-ink-50)' };
  }
}

/** Overlay + karta modalu s titulkem a ✕. Klik na overlay zavírá. */
function ModalCard({ width = 420, title, titleStyle = {}, onClose, zIndex = 50, cardStyle = {}, children }) {
  return (
    <div
      className="modal-overlay"
      onClick={onClose}
      style={{ ...modalOverlayStyle, zIndex }}
    >
      <div
        className="md-modal"
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--color-field)',
          width: '100%', maxWidth: width, maxHeight: '85vh',
          borderRadius: 14, padding: '22px 22px 20px',
          boxShadow: '0 20px 50px rgba(12,27,42,.3)',
          display: 'flex', flexDirection: 'column',
          ...cardStyle,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <h2 style={{
            fontFamily: "'Space Grotesk', system-ui, sans-serif",
            fontWeight: 700, fontSize: 16, color: 'var(--color-ink)', margin: 0,
            ...titleStyle,
          }}>
            {title}
          </h2>
          <button
            onClick={onClose}
            aria-label="Zavřít"
            style={{
              width: 28, height: 28, borderRadius: 8,
              background: 'var(--color-line-grid)', border: 'none',
              cursor: 'pointer', color: 'var(--color-ink-50)', fontSize: 13,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}
          >✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ── style helpers ─────────────────────────────────────────────────────────────

const navBtnStyle = {
  width: 32, height: 32, padding: 0,
  background: T.field, border: '1px solid var(--color-input)',
  borderRadius: 8, cursor: 'pointer',
  color: T.ink, fontFamily: T.sg, fontSize: 12, fontWeight: 600,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  transition: 'background .15s',
};

function iconBtnStyle(color) {
  return {
    width: 30, height: 30, borderRadius: 6,
    border: 'none', background: 'none',
    color, cursor: 'pointer', display: 'flex',
    alignItems: 'center', justifyContent: 'center',
    transition: 'background .15s',
    flexShrink: 0,
  };
}

const pwInputStyle = {
  width: '100%', boxSizing: 'border-box',
  height: 42, border: '1px solid var(--color-input)', borderRadius: 10,
  fontFamily: T.inter, fontSize: 14, color: T.ink,
  padding: '0 38px 0 14px', outline: 'none',
  background: 'var(--color-input-bg)', transition: 'border-color .15s',
};

const eyeBtnStyle = {
  position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
  background: 'none', border: 'none', cursor: 'pointer',
  color: T.ink30, padding: 4,
  display: 'flex', alignItems: 'center',
};
