import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';

// Design tokeny — tenká vrstva nad CSS proměnnými z @theme (src/index.css).
const T = {
  ink:     'var(--color-ink)',
  signal:  'var(--color-signal)',
  free:    'var(--color-success)',
  base:    'var(--color-base)',
  field:   'var(--color-field)',
  line:    'var(--color-line)',
  ink50:   'var(--color-ink-50)',
  ink30:   'var(--color-ink-30)',
  danger:  'var(--color-danger)',
  sg:      'var(--font-sg)',
  inter:   'var(--font-sg)',   // Inter vyřazen — sjednoceno na Space Grotesk
  mono:    'var(--font-mono)', // IBM Plex Mono
};

function pluralVozidlo(n) {
  if (n === 1) return 'vozidlo';
  if (n >= 2 && n <= 4) return 'vozidla';
  return 'vozidel';
}

function pluralRezervace(n) {
  if (n === 1) return 'rezervace';
  return 'rezervací';
}

// „10.07. 8:00 → 12.07. 16:00" — mono rozsah pro seznam v dialogu
function fmtRange(from, to) {
  const f = parseISO(from), t = parseISO(to);
  return `${format(f, 'dd.MM.')} ${format(f, 'H:mm')} → ${format(t, 'dd.MM.')} ${format(t, 'H:mm')}`;
}

// ── modal shell (vzor ModalCard z Dashboard.jsx) ──────────────────────────────

function modalBtn(variant = 'outline') {
  const base = {
    flex: 1, height: 44, borderRadius: 10, cursor: 'pointer',
    fontFamily: T.sg, fontSize: 13, fontWeight: 600, border: 'none',
    transition: 'background .15s, opacity .15s',
  };
  switch (variant) {
    case 'navy':
      return { ...base, flex: 1.4, fontWeight: 700, background: T.ink, color: '#fff' };
    case 'danger':
      return { ...base, flex: 1.3, fontWeight: 700, background: T.danger, color: '#fff' };
    default:
      return { ...base, background: 'none', border: '1px solid var(--color-input)', color: T.ink50 };
  }
}

function ModalCard({ width = 420, title, onClose, children }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 50,
        background: 'rgba(12,27,42,.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: T.field,
          width: '100%', maxWidth: width, maxHeight: '85vh',
          borderRadius: 14, padding: '22px 22px 20px',
          boxShadow: '0 20px 50px rgba(12,27,42,.3)',
          display: 'flex', flexDirection: 'column',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <h2 style={{ fontFamily: T.sg, fontWeight: 700, fontSize: 16, color: T.ink, margin: 0 }}>
            {title}
          </h2>
          <button
            onClick={onClose}
            aria-label="Zavřít"
            style={{
              width: 28, height: 28, borderRadius: 8,
              background: 'var(--color-line-grid)', border: 'none',
              cursor: 'pointer', color: T.ink50, fontSize: 13,
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

const monoLabelStyle = {
  display: 'block',
  fontFamily: T.mono, fontWeight: 500, fontSize: 10,
  color: T.ink50, textTransform: 'uppercase',
  letterSpacing: '0.12em', marginBottom: 6,
};

const inputStyle = {
  width: '100%', boxSizing: 'border-box',
  height: 42, border: '1px solid var(--color-input)', borderRadius: 10,
  fontFamily: T.inter, fontSize: 14, color: T.ink,
  padding: '0 14px', outline: 'none',
  background: 'var(--color-input-bg)', transition: 'border-color .15s',
};

// Textová akce v řádku (vzor kniha rezervací)
function rowAction(color) {
  return {
    background: 'none', border: 'none', cursor: 'pointer',
    fontFamily: T.sg, fontSize: 12, fontWeight: 600,
    color, padding: '8px 6px', borderRadius: 6,
    transition: 'background .15s',
  };
}

export default function AdminVehicles() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [vehicles,  setVehicles]  = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [toast,     setToast]     = useState(null);

  // Formulář (přidat i upravit) — editTarget = null (zavřeno) | {} (nové) | vehicle (úprava)
  const [editTarget, setEditTarget] = useState(null);
  const [formName,   setFormName]   = useState('');
  const [formPlate,  setFormPlate]  = useState('');
  const [formError,  setFormError]  = useState('');
  const [formBusy,   setFormBusy]   = useState(false);

  // Potvrzení destruktivní akce — {vehicle, kind: 'deactivate' | 'delete'}
  const [confirm,      setConfirm]      = useState(null);
  const [confirmError, setConfirmError] = useState('');
  const [confirmBusy,  setConfirmBusy]  = useState(false);

  // Hromadné zrušení budoucích rezervací — bulkTarget = vozidlo | null
  const [bulkTarget,  setBulkTarget]  = useState(null);
  const [bulkList,    setBulkList]    = useState([]);   // seznam z GET .../bookings/future
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkError,   setBulkError]   = useState('');
  const [bulkAgreed,  setBulkAgreed]  = useState(false);
  const [bulkBusy,    setBulkBusy]    = useState(false);

  useEffect(() => { fetchVehicles(); }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  // Scroll-lock stránky pod modalem (stejné chování jako Dashboard)
  const anyModalOpen = !!editTarget || !!confirm || !!bulkTarget;
  useEffect(() => {
    document.body.style.overflow = anyModalOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [anyModalOpen]);

  async function fetchVehicles() {
    setLoading(true);
    setLoadError(false);
    try {
      const { data } = await api.get('/vehicles/admin');
      setVehicles(data);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }

  function openCreate() {
    setEditTarget({});
    setFormName('');
    setFormPlate('');
    setFormError('');
  }

  function openEdit(v) {
    setEditTarget(v);
    setFormName(v.name);
    setFormPlate(v.plate);
    setFormError('');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setFormBusy(true);
    setFormError('');
    const isNew = !editTarget.id;
    try {
      if (isNew) {
        await api.post('/vehicles', { name: formName, plate: formPlate });
      } else {
        await api.put(`/vehicles/${editTarget.id}`, { name: formName, plate: formPlate });
      }
      setEditTarget(null);
      setToast({ msg: isNew ? 'Vozidlo přidáno.' : 'Vozidlo upraveno.', ok: true });
      fetchVehicles();
    } catch (err) {
      setFormError(err.response?.data?.message || 'Uložení se nezdařilo.');
    } finally {
      setFormBusy(false);
    }
  }

  async function handleRestore(v) {
    try {
      await api.put(`/vehicles/${v.id}`, { active: true });
      setToast({ msg: 'Vozidlo obnoveno.', ok: true });
      fetchVehicles();
    } catch (err) {
      setToast({ msg: err.response?.data?.message || 'Obnovení se nezdařilo.', ok: false });
    }
  }

  async function handleConfirm() {
    setConfirmBusy(true);
    setConfirmError('');
    try {
      if (confirm.kind === 'deactivate') {
        await api.put(`/vehicles/${confirm.vehicle.id}`, { active: false });
        setToast({ msg: 'Vozidlo vyřazeno z provozu.', ok: false });
      } else {
        await api.delete(`/vehicles/${confirm.vehicle.id}`);
        setToast({ msg: 'Vozidlo smazáno.', ok: false });
      }
      setConfirm(null);
      fetchVehicles();
    } catch (err) {
      let msg = err.response?.data?.message || 'Akce se nezdařila.';
      // 409 u vyřazení = budoucí rezervace → navést na hromadné zrušení
      if (confirm.kind === 'deactivate' && err.response?.status === 409) {
        msg += ' Zrušte je tlačítkem „Zrušit budoucí rezervace" v řádku vozidla.';
      }
      setConfirmError(msg);
      fetchVehicles(); // 409 = mezitím přibyla rezervace → srovnat počty v seznamu
    } finally {
      setConfirmBusy(false);
    }
  }

  // ── hromadné zrušení budoucích rezervací ────────────────────────────────────

  async function openBulkCancel(v) {
    setBulkTarget(v);
    setBulkList([]);
    setBulkError('');
    setBulkAgreed(false);
    setBulkLoading(true);
    try {
      const { data } = await api.get(`/vehicles/${v.id}/bookings/future`);
      setBulkList(data);
    } catch {
      setBulkError('Nepodařilo se načíst seznam rezervací.');
    } finally {
      setBulkLoading(false);
    }
  }

  async function handleBulkCancel() {
    setBulkBusy(true);
    setBulkError('');
    try {
      // Ruší se JEN ids zobrazené v dialogu — rezervace vzniklé mezitím přežijí
      const { data } = await api.post(`/vehicles/${bulkTarget.id}/bookings/cancel-future`, {
        ids: bulkList.map(b => b.id),
      });
      setBulkTarget(null);
      setToast({ msg: `Zrušeno ${data.cancelled} ${pluralRezervace(data.cancelled)}.`, ok: false });
      fetchVehicles();
    } catch (err) {
      setBulkError(err.response?.data?.message || 'Hromadné zrušení se nezdařilo.');
    } finally {
      setBulkBusy(false);
    }
  }

  const initials = user
    ? `${user.firstName[0]}${user.lastName[0]}`.toUpperCase()
    : '?';

  return (
    <div style={{ minHeight: '100vh', background: T.base, fontFamily: T.inter }}>

      {/* ── HEADER (světlý — vzor 7/7) ──────────────────────────────────────────── */}
      <header style={{
        background: T.base,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 28px',
        borderBottom: `1px solid ${T.line}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <button
            onClick={() => navigate('/')}
            aria-label="Zpět na přehled"
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: 'none', border: 'none', cursor: 'pointer',
              color: T.ink50, fontFamily: T.sg, fontSize: 12, fontWeight: 600,
              padding: '4px 2px', transition: 'color .15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-ink)')}
            onMouseLeave={e => (e.currentTarget.style.color = T.ink50)}
          >
            ‹ Zpět
          </button>

          <div style={{ width: 1, height: 18, background: T.line }} />

          <span style={{ fontFamily: T.sg, fontSize: 15, fontWeight: 700, color: T.ink }}>
            Správa vozidel
          </span>
        </div>

        <div style={{
          width: 30, height: 30, borderRadius: 8, flexShrink: 0,
          background: T.ink,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: T.mono, fontWeight: 600, fontSize: 11,
          color: 'var(--color-signal-light)',
        }}>
          {initials}
        </div>
      </header>

      {/* ── CONTENT ─────────────────────────────────────────────────────────────── */}
      <div style={{ maxWidth: 860, margin: '0 auto', padding: '24px 28px 60px', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Přidat + počet */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <button
            onClick={openCreate}
            style={{
              height: 36, padding: '0 18px',
              background: T.ink, color: '#fff',
              fontFamily: T.sg, fontSize: 12, fontWeight: 700,
              border: 'none', borderRadius: 8, cursor: 'pointer',
              transition: 'opacity .15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.opacity = .88)}
            onMouseLeave={e => (e.currentTarget.style.opacity = 1)}
          >
            + Přidat vozidlo
          </button>

          {!loading && !loadError && (
            <span style={{ fontFamily: T.mono, fontWeight: 500, fontSize: 11, color: T.ink30, flexShrink: 0 }}>
              {vehicles.length} {pluralVozidlo(vehicles.length)}
            </span>
          )}
        </div>

        {/* Body */}
        {loading ? (
          <div style={{
            background: T.field, border: `1px solid ${T.line}`, borderRadius: 12,
            padding: '32px 20px', textAlign: 'center',
            color: T.ink30, fontFamily: T.inter, fontSize: 13,
          }}>
            Načítám...
          </div>
        ) : loadError ? (
          <div style={{
            background: T.field, border: `1px solid ${T.line}`, borderRadius: 12,
            padding: '32px 20px', textAlign: 'center',
          }}>
            <div style={{ fontFamily: T.sg, fontSize: 14, fontWeight: 600, color: T.danger, marginBottom: 12 }}>
              Nepodařilo se načíst data.
            </div>
            <button
              onClick={fetchVehicles}
              style={{
                fontFamily: T.inter, fontSize: 13, color: 'var(--color-signal-link)',
                background: 'none', border: '1px solid var(--color-input)', borderRadius: 8,
                cursor: 'pointer', padding: '6px 16px',
              }}
            >
              Zkusit znovu
            </button>
          </div>
        ) : vehicles.length === 0 ? (
          <div style={{
            background: T.field, border: '1px dashed var(--color-input)',
            borderRadius: 12, padding: 28, textAlign: 'center',
          }}>
            <div style={{ fontFamily: T.sg, fontSize: 13, fontWeight: 700, color: T.ink }}>
              Žádná vozidla.
            </div>
            <div style={{ fontFamily: T.inter, fontSize: 12, color: T.ink30, marginTop: 4 }}>
              Přidejte první vozidlo tlačítkem výše.
            </div>
          </div>
        ) : (
          <div style={{ background: T.field, border: `1px solid ${T.line}`, borderRadius: 12, overflow: 'hidden' }}>
            {vehicles.map((v, i) => {
              const isLast = i === vehicles.length - 1;
              return (
                <div key={v.id} style={{ borderBottom: isLast ? 'none' : '1px solid var(--color-line-row)' }}>
                  <div className="veh-row" style={{
                    display: 'flex', alignItems: 'center', gap: 16,
                    padding: '16px 20px', flexWrap: 'wrap',
                  }}>
                    {/* Info */}
                    <div style={{ flex: 1, minWidth: 200 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontFamily: T.sg, fontWeight: 700, fontSize: 14, color: v.active ? T.ink : T.ink50 }}>
                          {v.name}
                        </span>
                        {v.plate && (
                          <span style={{
                            fontFamily: T.mono, fontWeight: 600, fontSize: 10,
                            letterSpacing: '0.06em', padding: '2px 7px',
                            background: 'var(--color-line-grid)',
                            border: '1px solid var(--color-input)',
                            borderRadius: 4, color: T.ink50,
                          }}>
                            {v.plate}
                          </span>
                        )}
                        <span style={{
                          fontFamily: T.mono, fontWeight: 600, fontSize: 9,
                          letterSpacing: '0.08em', padding: '2px 6px',
                          borderRadius: 4,
                          background: v.active ? 'var(--color-success-bg)' : 'var(--color-line-grid)',
                          border: v.active ? '1px solid var(--color-success-border)' : '1px solid var(--color-input)',
                          color: v.active ? T.free : T.ink30,
                        }}>
                          {v.active ? 'AKTIVNÍ' : 'VYŘAZENO'}
                        </span>
                      </div>
                      <div style={{ fontFamily: T.mono, fontSize: 11, color: T.ink30, marginTop: 3 }}>
                        {v.futureBookings > 0
                          ? `${v.futureBookings} ${v.futureBookings === 1 ? 'budoucí' : 'budoucích'} ${pluralRezervace(v.futureBookings)}`
                          : 'bez budoucích rezervací'}
                        {' · '}{v.totalBookings} celkem
                      </div>
                    </div>

                    {/* Akce */}
                    <div className="veh-actions" style={{ display: 'flex', gap: 4, flexShrink: 0, alignItems: 'center' }}>
                      <button
                        onClick={() => openEdit(v)}
                        style={rowAction('var(--color-signal-link)')}
                        onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-signal-bg)')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                      >
                        Upravit
                      </button>
                      {v.futureBookings > 0 && (
                        <button
                          onClick={() => openBulkCancel(v)}
                          style={rowAction(T.danger)}
                          onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-danger-bg)')}
                          onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                        >
                          Zrušit budoucí rezervace
                        </button>
                      )}
                      {v.active ? (
                        <button
                          onClick={() => { setConfirm({ vehicle: v, kind: 'deactivate' }); setConfirmError(''); }}
                          style={rowAction(T.danger)}
                          onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-danger-bg)')}
                          onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                        >
                          Vyřadit
                        </button>
                      ) : (
                        <button
                          onClick={() => handleRestore(v)}
                          style={rowAction('var(--color-signal-link)')}
                          onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-signal-bg)')}
                          onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                        >
                          ↺ Obnovit
                        </button>
                      )}
                      {v.totalBookings === 0 && (
                        <button
                          onClick={() => { setConfirm({ vehicle: v, kind: 'delete' }); setConfirmError(''); }}
                          style={rowAction(T.danger)}
                          onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-danger-bg)')}
                          onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                        >
                          Smazat
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── FORMULÁŘ (přidat / upravit) ─────────────────────────────────────────── */}
      {editTarget && (
        <ModalCard
          title={editTarget.id ? 'Upravit vozidlo' : 'Přidat vozidlo'}
          onClose={() => setEditTarget(null)}
        >
          <form onSubmit={handleSubmit}>
            <div style={{ marginTop: 16 }}>
              <label style={monoLabelStyle}>Název</label>
              <input
                value={formName}
                onChange={e => setFormName(e.target.value)}
                placeholder="např. Škoda Scala"
                required
                autoFocus
                style={inputStyle}
                onFocus={e => (e.currentTarget.style.borderColor = T.signal)}
                onBlur={e => (e.currentTarget.style.borderColor = 'var(--color-input)')}
              />
            </div>
            <div style={{ marginTop: 14 }}>
              <label style={monoLabelStyle}>SPZ</label>
              <input
                value={formPlate}
                onChange={e => setFormPlate(e.target.value)}
                placeholder="např. 1AB 2345"
                required
                style={{ ...inputStyle, fontFamily: T.mono, letterSpacing: '0.04em' }}
                onFocus={e => (e.currentTarget.style.borderColor = T.signal)}
                onBlur={e => (e.currentTarget.style.borderColor = 'var(--color-input)')}
              />
            </div>

            {formError && (
              <p style={{
                fontFamily: T.inter, fontSize: 13, color: T.danger,
                background: 'var(--color-danger-bg)', border: '1px solid var(--color-danger-border)',
                borderRadius: 8, padding: '8px 12px', margin: '14px 0 0',
              }}>
                {formError}
              </p>
            )}

            <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
              <button
                type="button"
                onClick={() => setEditTarget(null)}
                style={modalBtn()}
                onMouseEnter={e => (e.currentTarget.style.background = T.base)}
                onMouseLeave={e => (e.currentTarget.style.background = 'none')}
              >
                Zavřít
              </button>
              <button
                type="submit"
                disabled={formBusy}
                style={{ ...modalBtn('navy'), opacity: formBusy ? .6 : 1 }}
              >
                {formBusy ? 'Ukládám…' : (editTarget.id ? 'Uložit' : 'Přidat')}
              </button>
            </div>
          </form>
        </ModalCard>
      )}

      {/* ── POTVRZENÍ (Vyřadit / Smazat) ────────────────────────────────────────── */}
      {confirm && (
        <ModalCard
          width={340}
          title={confirm.kind === 'deactivate' ? 'Vyřadit vozidlo?' : 'Smazat vozidlo?'}
          onClose={() => setConfirm(null)}
        >
          <div style={{
            marginTop: 12, padding: '12px 14px',
            background: confirm.kind === 'delete' ? 'var(--color-danger-bg)' : 'var(--color-line-grid)',
            border: confirm.kind === 'delete' ? '1px solid var(--color-danger-border)' : '1px solid var(--color-input)',
            borderRadius: 10,
          }}>
            <div style={{ fontFamily: T.sg, fontWeight: 700, fontSize: 13, color: confirm.kind === 'delete' ? T.danger : T.ink }}>
              {confirm.vehicle.name}
            </div>
            {confirm.vehicle.plate && (
              <div style={{ fontFamily: T.mono, fontSize: 11, color: T.ink50, marginTop: 2 }}>
                {confirm.vehicle.plate}
              </div>
            )}
          </div>

          <div style={{ marginTop: 10, fontFamily: T.inter, fontSize: 12, lineHeight: 1.5, color: T.ink30 }}>
            {confirm.kind === 'deactivate'
              ? 'Vozidlo se skryje z výběru, historie rezervací zůstane. Kdykoli jde obnovit.'
              : 'Trvale odstranit? Nelze vrátit.'}
          </div>

          {confirmError && (
            <p style={{
              fontFamily: T.inter, fontSize: 13, color: T.danger,
              background: 'var(--color-danger-bg)', border: '1px solid var(--color-danger-border)',
              borderRadius: 8, padding: '8px 12px', margin: '12px 0 0',
            }}>
              {confirmError}
            </p>
          )}

          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <button
              onClick={() => setConfirm(null)}
              style={modalBtn()}
              onMouseEnter={e => (e.currentTarget.style.background = T.base)}
              onMouseLeave={e => (e.currentTarget.style.background = 'none')}
            >
              Zpět
            </button>
            <button
              onClick={handleConfirm}
              disabled={confirmBusy}
              style={{ ...modalBtn('danger'), opacity: confirmBusy ? .6 : 1 }}
              onMouseEnter={e => { if (!confirmBusy) e.currentTarget.style.background = 'var(--color-danger-hover)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = T.danger; }}
            >
              {confirmBusy ? 'Pracuji…' : (confirm.kind === 'deactivate' ? 'Vyřadit' : 'Smazat')}
            </button>
          </div>
        </ModalCard>
      )}

      {/* ── HROMADNÉ ZRUŠENÍ BUDOUCÍCH REZERVACÍ ────────────────────────────────── */}
      {bulkTarget && (
        <ModalCard
          title="Zrušit budoucí rezervace?"
          onClose={() => setBulkTarget(null)}
        >
          <div style={{ fontFamily: T.mono, fontSize: 11, color: T.ink50, marginTop: 6 }}>
            {bulkTarget.name}{bulkTarget.plate ? ` · ${bulkTarget.plate}` : ''}
          </div>

          {/* Seznam rušených rezervací — viditelný, hlavní tření proti omylu */}
          {bulkLoading ? (
            <div style={{ padding: '20px 0', textAlign: 'center', fontFamily: T.inter, fontSize: 13, color: T.ink30 }}>
              Načítám rezervace…
            </div>
          ) : bulkList.length === 0 ? (
            <div style={{
              marginTop: 12, padding: '14px 16px', borderRadius: 10,
              border: '1px dashed var(--color-input)',
              fontFamily: T.inter, fontSize: 13, color: T.ink30,
            }}>
              Žádné budoucí rezervace ke zrušení.
            </div>
          ) : (
            <div style={{
              marginTop: 12, maxHeight: 240, overflowY: 'auto',
              border: '1px solid var(--color-line-row)', borderRadius: 10,
            }}>
              {bulkList.map((b, i) => (
                <div key={b.id} style={{
                  padding: '9px 12px',
                  borderTop: i > 0 ? '1px solid var(--color-line-row)' : 'none',
                }}>
                  <div style={{ fontFamily: T.mono, fontWeight: 600, fontSize: 12, color: T.ink }}>
                    {fmtRange(b.dateFrom, b.dateTo)}
                  </div>
                  <div style={{
                    fontFamily: T.inter, fontSize: 12, color: T.ink50, marginTop: 2,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {`${b.user?.firstName ?? ''} ${b.user?.lastName ?? ''}`.trim()} · {b.purpose}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Varování */}
          {bulkList.length > 0 && (
            <div style={{
              marginTop: 10, padding: '10px 12px',
              background: 'var(--color-danger-bg)', border: '1px solid var(--color-danger-border)',
              borderRadius: 8, fontFamily: T.inter, fontSize: 12.5, lineHeight: 1.5, color: T.danger,
            }}>
              Vlastníci dostanou e-mail o zrušení. Akci nelze vrátit.
            </div>
          )}

          {/* Běžící rezervace se neruší — vysvětlit, jinak admin nechápe další 409 u Vyřadit */}
          {!bulkLoading && bulkTarget.futureBookings > bulkList.length && (
            <div style={{
              marginTop: 8, padding: '10px 12px',
              background: 'var(--color-note-bg, var(--color-line-grid))',
              border: '1px solid var(--color-input)',
              borderRadius: 8, fontFamily: T.inter, fontSize: 12.5, lineHeight: 1.5, color: T.ink50,
            }}>
              Právě probíhající rezervace se neruší (vozidlo je na cestě); vyřadit půjde až po jejím skončení.
            </div>
          )}

          {bulkError && (
            <p style={{
              fontFamily: T.inter, fontSize: 13, color: T.danger,
              background: 'var(--color-danger-bg)', border: '1px solid var(--color-danger-border)',
              borderRadius: 8, padding: '8px 12px', margin: '10px 0 0',
            }}>
              {bulkError}
            </p>
          )}

          {bulkList.length > 0 && (
            <label style={{
              display: 'flex', alignItems: 'flex-start', gap: 10,
              marginTop: 12, cursor: 'pointer',
            }}>
              <input
                type="checkbox"
                checked={bulkAgreed}
                onChange={e => setBulkAgreed(e.target.checked)}
                style={{ width: 16, height: 16, marginTop: 1, accentColor: 'var(--color-danger)', flexShrink: 0 }}
              />
              <span style={{ fontFamily: T.inter, fontSize: 13, lineHeight: 1.4, color: T.ink }}>
                Rozumím
              </span>
            </label>
          )}

          <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            <button
              onClick={() => setBulkTarget(null)}
              style={modalBtn()}
              onMouseEnter={e => (e.currentTarget.style.background = T.base)}
              onMouseLeave={e => (e.currentTarget.style.background = 'none')}
            >
              Zpět
            </button>
            {bulkList.length > 0 && (
              <button
                onClick={handleBulkCancel}
                disabled={!bulkAgreed || bulkBusy || bulkLoading}
                style={{
                  ...modalBtn('danger'),
                  opacity: bulkAgreed && !bulkBusy && !bulkLoading ? 1 : 0.45,
                  cursor: bulkAgreed && !bulkBusy && !bulkLoading ? 'pointer' : 'not-allowed',
                }}
              >
                {bulkBusy ? 'Ruším…' : `Zrušit ${bulkList.length} ${pluralRezervace(bulkList.length)}`}
              </button>
            )}
          </div>
        </ModalCard>
      )}

      {/* ── TOAST ───────────────────────────────────────────────────────────────── */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'fixed', bottom: 26, left: '50%',
            transform: 'translateX(-50%)', zIndex: 200,
            background: toast.ok ? T.ink : T.danger,
            color: '#fff', borderRadius: 12,
            padding: '11px 20px',
            fontFamily: T.sg, fontSize: 13, fontWeight: 600,
            boxShadow: '0 10px 30px rgba(12,27,42,.35)',
            animation: 'toast-in .25s ease',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          {toast.msg}
        </div>
      )}

      <style>{`
        @keyframes toast-in {
          from { opacity: 0; transform: translate(-50%, 10px); }
          to   { opacity: 1; transform: translate(-50%, 0); }
        }
        @media (max-width: 639px) {
          .veh-actions { width: 100%; justify-content: flex-end; }
          .veh-actions button { padding: 12px 10px; }
        }
        @media (prefers-reduced-motion: reduce) {
          * { animation-duration: 0.01ms !important; }
        }
      `}</style>
    </div>
  );
}
