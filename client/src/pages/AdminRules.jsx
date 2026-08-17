import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import RulesModal from '../components/RulesModal';

// Design tokeny — tenká vrstva nad CSS proměnnými z @theme (src/index.css).
const T = {
  ink:    'var(--color-ink)',
  signal: 'var(--color-signal)',
  base:   'var(--color-base)',
  field:  'var(--color-field)',
  line:   'var(--color-line)',
  ink50:  'var(--color-ink-50)',
  ink30:  'var(--color-ink-30)',
  danger: 'var(--color-danger)',
  sg:     'var(--font-sg)',
  inter:  'var(--font-sg)',
  mono:   'var(--font-mono)',
};

const monoLabelStyle = {
  display: 'block',
  fontFamily: T.mono, fontWeight: 500, fontSize: 10,
  color: T.ink50, textTransform: 'uppercase',
  letterSpacing: '0.12em', marginBottom: 6,
};

const inputStyle = {
  width: '100%', boxSizing: 'border-box',
  height: 40, border: '1px solid var(--color-input)', borderRadius: 8,
  fontFamily: T.inter, fontSize: 14, fontWeight: 600, color: T.ink,
  padding: '0 12px', outline: 'none',
  background: 'var(--color-input-bg)', transition: 'border-color .15s',
};

const textareaStyle = {
  width: '100%', boxSizing: 'border-box',
  minHeight: 96, resize: 'vertical',
  border: '1px solid var(--color-input)', borderRadius: 8,
  fontFamily: T.inter, fontSize: 13, lineHeight: 1.55, color: T.ink,
  padding: '10px 12px', outline: 'none',
  background: 'var(--color-input-bg)', transition: 'border-color .15s',
};

function modalBtn(variant = 'outline') {
  const base = {
    flex: 1, height: 44, borderRadius: 10, cursor: 'pointer',
    fontFamily: T.sg, fontSize: 13, fontWeight: 600, border: 'none',
    transition: 'background .15s, opacity .15s',
  };
  if (variant === 'navy') return { ...base, flex: 1.4, fontWeight: 700, background: T.ink, color: '#fff' };
  return { ...base, background: 'none', border: '1px solid var(--color-input)', color: T.ink50 };
}

// Ikonové tlačítko pro akce sekce (↑ ↓ ✕)
function secBtn(disabled, color) {
  return {
    width: 28, height: 28, borderRadius: 6,
    border: '1px solid var(--color-input)', background: T.field,
    color: disabled ? 'var(--color-ink-10)' : color,
    cursor: disabled ? 'default' : 'pointer',
    fontFamily: T.sg, fontSize: 12, fontWeight: 600,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0, transition: 'background .15s',
  };
}

// Formulář drží odrážky jako text (řádek = odrážka); převod tam a zpět
const toDraft  = sections => sections.map(s => ({ id: s.id, title: s.title, text: s.items.join('\n') }));
const toApi    = draft => draft.map((s, i) => ({
  id: s.id || `sekce-${i + 1}`,
  title: s.title.trim(),
  items: s.text.split('\n').map(t => t.trim()).filter(Boolean),
}));

export default function AdminRules() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [current,   setCurrent]   = useState(null);  // { version, sections }
  const [draft,     setDraft]     = useState([]);    // [{ id, title, text }]
  const [loading,   setLoading]   = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [toast,     setToast]     = useState(null);

  const [preview,      setPreview]      = useState(false);
  const [confirmOpen,  setConfirmOpen]  = useState(false);
  const [confirmAgree, setConfirmAgree] = useState(false);
  const [publishBusy,  setPublishBusy]  = useState(false);
  const [publishError, setPublishError] = useState('');

  useEffect(() => { fetchRules(); }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  // Neuložené změny = draft se liší od publikované verze
  const dirty = useMemo(() => {
    if (!current) return false;
    return JSON.stringify(toApi(draft)) !== JSON.stringify(
      current.sections.map((s, i) => ({ id: s.id || `sekce-${i + 1}`, title: s.title, items: s.items }))
    );
  }, [draft, current]);

  // Varování při zavření záložky / odchodu s rozdělanou editací (bez draftu v localStorage)
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = e => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  async function fetchRules() {
    setLoading(true);
    setLoadError(false);
    try {
      const { data } = await api.get('/rules');
      setCurrent(data);
      setDraft(toDraft(data.sections));
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }

  function leavePage() {
    if (dirty && !window.confirm('Máte neuložené změny. Opravdu odejít?')) return;
    navigate('/');
  }

  // ── editace sekcí ───────────────────────────────────────────────────────────
  const patch = (i, key, value) => setDraft(d => d.map((s, j) => (j === i ? { ...s, [key]: value } : s)));
  const addSection = () => setDraft(d => [...d, { id: '', title: '', text: '' }]);
  const removeSection = i => setDraft(d => d.filter((_, j) => j !== i));
  const moveSection = (i, dir) => setDraft(d => {
    const j = i + dir;
    if (j < 0 || j >= d.length) return d;
    const copy = [...d];
    [copy[i], copy[j]] = [copy[j], copy[i]];
    return copy;
  });

  // Validace (stejná pravidla jako server) — vrací text chyby nebo null
  const validation = useMemo(() => {
    const parsed = toApi(draft);
    if (parsed.length === 0) return 'Pravidla musí mít alespoň jednu sekci.';
    for (const [i, s] of parsed.entries()) {
      if (!s.title) return `Sekce ${i + 1}: vyplňte nadpis.`;
      if (s.items.length === 0) return `Sekce „${s.title}“: vyplňte alespoň jednu odrážku.`;
    }
    return null;
  }, [draft]);

  async function handlePublish() {
    setPublishBusy(true);
    setPublishError('');
    try {
      const { data } = await api.post('/rules', { sections: toApi(draft) });
      setCurrent(data);
      setDraft(toDraft(data.sections));
      setConfirmOpen(false);
      setConfirmAgree(false);
      setToast({ msg: `Publikována verze ${data.version}.`, ok: true });
    } catch (err) {
      setPublishError(err.response?.data?.message || 'Publikace se nezdařila.');
    } finally {
      setPublishBusy(false);
    }
  }

  const initials = user ? `${user.firstName[0]}${user.lastName[0]}`.toUpperCase() : '?';
  const nextVersion = current ? current.version + 1 : '?';

  return (
    <div style={{ minHeight: '100vh', background: T.base, fontFamily: T.inter }}>

      {/* ── HEADER (světlý — vzor ostatních admin stránek) ───────────────────── */}
      <header style={{
        background: T.base,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 28px',
        borderBottom: `1px solid ${T.line}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <button
            onClick={leavePage}
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
            Úprava pravidel
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

      {/* ── CONTENT ──────────────────────────────────────────────────────────── */}
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '24px 28px 60px', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {loading ? (
          <div style={{
            background: T.field, border: `1px solid ${T.line}`, borderRadius: 12,
            padding: '32px 20px', textAlign: 'center', fontSize: 13, color: T.ink30,
          }}>
            Načítám pravidla…
          </div>
        ) : loadError ? (
          <div style={{
            background: T.field, border: `1px solid ${T.line}`, borderRadius: 12,
            padding: '32px 20px', textAlign: 'center',
          }}>
            <div style={{ fontFamily: T.sg, fontSize: 14, fontWeight: 600, color: T.danger, marginBottom: 12 }}>
              Nepodařilo se načíst pravidla.
            </div>
            <button
              onClick={fetchRules}
              style={{
                fontFamily: T.inter, fontSize: 13, color: 'var(--color-signal-link)',
                background: 'none', border: '1px solid var(--color-input)', borderRadius: 8,
                cursor: 'pointer', padding: '6px 16px',
              }}
            >
              Zkusit znovu
            </button>
          </div>
        ) : (
          <>
            {/* Stav + akce */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <span style={{ fontFamily: T.mono, fontWeight: 500, fontSize: 11, color: T.ink30 }}>
                  AKTUÁLNÍ VERZE {current.version} · {draft.length} {draft.length === 1 ? 'SEKCE' : 'SEKCÍ'}
                  {dirty && ' · NEULOŽENÉ ZMĚNY'}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => setPreview(true)}
                  style={{
                    height: 34, padding: '0 14px',
                    background: T.field, color: 'var(--color-signal-link)',
                    fontFamily: T.sg, fontSize: 12, fontWeight: 600,
                    border: '1px solid var(--color-input)', borderRadius: 8, cursor: 'pointer',
                  }}
                >
                  Náhled
                </button>
                <button
                  onClick={() => { setConfirmOpen(true); setConfirmAgree(false); setPublishError(''); }}
                  disabled={!!validation}
                  title={validation || ''}
                  style={{
                    height: 34, padding: '0 16px',
                    background: T.ink, color: '#fff',
                    fontFamily: T.sg, fontSize: 12, fontWeight: 700,
                    border: 'none', borderRadius: 8,
                    cursor: validation ? 'not-allowed' : 'pointer',
                    opacity: validation ? 0.45 : 1,
                  }}
                >
                  Publikovat novou verzi
                </button>
              </div>
            </div>

            {validation && (
              <div style={{
                padding: '10px 12px', borderRadius: 8,
                background: 'var(--color-danger-bg)', border: '1px solid var(--color-danger-border)',
                fontFamily: T.inter, fontSize: 12.5, color: T.danger,
              }}>
                {validation}
              </div>
            )}

            {/* Sekce */}
            {draft.map((sec, i) => (
              <div key={i} style={{
                background: T.field, border: `1px solid ${T.line}`,
                borderRadius: 12, padding: 16,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <span style={{ fontFamily: T.mono, fontWeight: 600, fontSize: 12, color: 'var(--color-signal-deep)', flexShrink: 0 }}>
                    {i + 1}.
                  </span>
                  <input
                    value={sec.title}
                    onChange={e => patch(i, 'title', e.target.value)}
                    placeholder="Nadpis sekce"
                    style={inputStyle}
                    onFocus={e => (e.currentTarget.style.borderColor = T.signal)}
                    onBlur={e => (e.currentTarget.style.borderColor = 'var(--color-input)')}
                  />
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                    <button onClick={() => moveSection(i, -1)} disabled={i === 0}
                            aria-label="Posunout nahoru" style={secBtn(i === 0, T.ink50)}>↑</button>
                    <button onClick={() => moveSection(i, 1)} disabled={i === draft.length - 1}
                            aria-label="Posunout dolů" style={secBtn(i === draft.length - 1, T.ink50)}>↓</button>
                    <button onClick={() => removeSection(i)} disabled={draft.length === 1}
                            aria-label="Smazat sekci" style={secBtn(draft.length === 1, T.danger)}>✕</button>
                  </div>
                </div>
                <label style={monoLabelStyle}>
                  Odrážky <span style={{ color: 'var(--color-ink-10)', letterSpacing: 0, textTransform: 'none' }}>· každý řádek = jedna odrážka</span>
                </label>
                <textarea
                  value={sec.text}
                  onChange={e => patch(i, 'text', e.target.value)}
                  placeholder={'První odrážka\nDruhá odrážka'}
                  style={textareaStyle}
                  onFocus={e => (e.currentTarget.style.borderColor = T.signal)}
                  onBlur={e => (e.currentTarget.style.borderColor = 'var(--color-input)')}
                />
              </div>
            ))}

            <button
              onClick={addSection}
              style={{
                background: 'none', border: '1px dashed var(--color-input)',
                borderRadius: 12, padding: '14px 20px', cursor: 'pointer',
                fontFamily: T.sg, fontSize: 13, fontWeight: 600, color: T.ink50,
                transition: 'background .15s',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = T.field)}
              onMouseLeave={e => (e.currentTarget.style.background = 'none')}
            >
              + Přidat sekci
            </button>
          </>
        )}
      </div>

      {/* ── NÁHLED (draft obsah, read-only režim modalu) ─────────────────────── */}
      {preview && (
        <RulesModal mode="view" sections={toApi(draft)} onClose={() => setPreview(false)} />
      )}

      {/* ── POTVRZENÍ PUBLIKACE ──────────────────────────────────────────────── */}
      {confirmOpen && (
        <div
          onClick={() => setConfirmOpen(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 70,
            background: 'rgba(12,27,42,.45)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: T.field, width: '100%', maxWidth: 400,
              borderRadius: 14, padding: '22px 22px 20px',
              boxShadow: '0 20px 50px rgba(12,27,42,.3)',
            }}
          >
            <h2 style={{ fontFamily: T.sg, fontWeight: 700, fontSize: 16, color: T.ink, margin: 0 }}>
              Publikovat verzi {nextVersion}?
            </h2>

            <div style={{
              marginTop: 12, padding: '12px 14px', borderRadius: 10,
              background: 'var(--color-danger-bg)', border: '1px solid var(--color-danger-border)',
              fontFamily: T.inter, fontSize: 12.5, lineHeight: 1.5, color: T.danger,
            }}>
              Všichni uživatelé budou muset pravidla znovu potvrdit. Dokud tak neučiní, nemohou vytvářet rezervace.
            </div>

            {publishError && (
              <p style={{
                fontFamily: T.inter, fontSize: 13, color: T.danger,
                background: 'var(--color-danger-bg)', border: '1px solid var(--color-danger-border)',
                borderRadius: 8, padding: '8px 12px', margin: '10px 0 0',
              }}>
                {publishError}
              </p>
            )}

            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginTop: 14, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={confirmAgree}
                onChange={e => setConfirmAgree(e.target.checked)}
                style={{ width: 16, height: 16, marginTop: 1, accentColor: 'var(--color-signal-deep)', flexShrink: 0 }}
              />
              <span style={{ fontFamily: T.inter, fontSize: 13, lineHeight: 1.4, color: T.ink }}>
                Rozumím
              </span>
            </label>

            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button
                onClick={() => setConfirmOpen(false)}
                style={modalBtn()}
                onMouseEnter={e => (e.currentTarget.style.background = T.base)}
                onMouseLeave={e => (e.currentTarget.style.background = 'none')}
              >
                Zpět
              </button>
              <button
                onClick={handlePublish}
                disabled={!confirmAgree || publishBusy}
                style={{
                  ...modalBtn('navy'),
                  opacity: confirmAgree && !publishBusy ? 1 : 0.45,
                  cursor: confirmAgree && !publishBusy ? 'pointer' : 'not-allowed',
                }}
              >
                {publishBusy ? 'Publikuji…' : 'Publikovat'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── TOAST ────────────────────────────────────────────────────────────── */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'fixed', bottom: 26, left: '50%',
            transform: 'translateX(-50%)', zIndex: 200,
            background: toast.ok ? T.ink : T.danger,
            color: '#fff', borderRadius: 12, padding: '11px 20px',
            fontFamily: T.sg, fontSize: 13, fontWeight: 600,
            boxShadow: '0 10px 30px rgba(12,27,42,.35)',
            animation: 'toast-in .25s ease', pointerEvents: 'none', whiteSpace: 'nowrap',
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
        @media (prefers-reduced-motion: reduce) {
          * { animation-duration: 0.01ms !important; }
        }
      `}</style>
    </div>
  );
}
