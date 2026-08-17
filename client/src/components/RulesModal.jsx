import { useState, useEffect, useRef, useCallback } from 'react';

// Design tokeny — tenká vrstva nad CSS proměnnými z @theme (src/index.css)
const T = {
  ink:    'var(--color-ink)',
  base:   'var(--color-base)',
  ink50:  'var(--color-ink-50)',
  ink30:  'var(--color-ink-30)',
  danger: 'var(--color-danger)',
  sg:     'var(--font-sg)',
  inter:  'var(--font-sg)',
  mono:   'var(--font-mono)',
};

// Statická hlavička dokumentu; text sekcí žije v DB (GET /api/rules)
export const RULES_TITLE    = 'Pravidla používání služebního vozidla';
export const RULES_SUBTITLE = 'Vozidla: Škoda Scala · dodávka MAN';

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

function modalBtn(variant = 'outline') {
  const base = {
    flex: 1, height: 44, borderRadius: 10, cursor: 'pointer',
    fontFamily: T.sg, fontSize: 13, fontWeight: 600, border: 'none',
    transition: 'background .15s, opacity .15s',
  };
  if (variant === 'navy') {
    return { ...base, flex: 1.4, fontWeight: 700, background: T.ink, color: '#fff' };
  }
  return { ...base, background: 'none', border: '1px solid var(--color-input)', color: T.ink50 };
}

/**
 * Modal s pravidly. mode 'accept' = jednorázové potvrzení (scroll až dolů →
 * checkbox → Potvrdit; nejde zavřít jinak než potvrzením nebo odhlášením),
 * mode 'view' = read-only náhled (✕ / Zavřít / klik na overlay).
 * Sekce přicházejí propem (z DB přes GET /api/rules, nebo draft z admin editoru).
 */
export default function RulesModal({ mode, sections, onConfirm, onClose, confirming = false, error = '' }) {
  const bodyRef = useRef(null);
  // 'view' režim scroll nevynucuje; latch — jednou true, zpětný scroll nevypne
  const [readToEnd, setReadToEnd] = useState(mode === 'view');
  const [agreed, setAgreed] = useState(false);
  const loading = !sections; // obsah přichází ze sítě (GET /api/rules)

  const checkScroll = useCallback(() => {
    const el = bodyRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 12) setReadToEnd(true);
  }, []);

  // Edge case: obsah se na velkém okně nemusí scrollovat vůbec →
  // bez kontroly při mountu by checkbox nešel odemknout nikdy.
  // Po doručení obsahu (loading → false) se musí přeměřit znovu.
  useEffect(() => { if (!loading) checkScroll(); }, [checkScroll, loading]);

  const isAccept = mode === 'accept';

  return (
    <div
      className="modal-overlay"
      onClick={isAccept ? undefined : onClose}
      style={{ ...modalOverlayStyle, zIndex: 60 }}
    >
      <div
        className="md-modal"
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--color-field)',
          width: '100%', maxWidth: 560, maxHeight: '85vh',
          borderRadius: 14, padding: '22px 22px 18px',
          boxShadow: '0 20px 50px rgba(12,27,42,.3)',
          display: 'flex', flexDirection: 'column',
        }}
      >
        {/* hlavička */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <h2 style={{ fontFamily: T.sg, fontWeight: 700, fontSize: 16, color: T.ink, margin: 0 }}>
              {RULES_TITLE}
            </h2>
            <div style={{ ...monoLabelStyle, marginTop: 5, marginBottom: 0 }}>
              {RULES_SUBTITLE}
            </div>
          </div>
          {!isAccept && (
            <button
              onClick={onClose}
              aria-label="Zavřít"
              style={{
                width: 28, height: 28, borderRadius: 8,
                background: 'var(--color-line-grid)', border: 'none',
                cursor: 'pointer', color: T.ink50, fontSize: 13,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0, marginLeft: 12,
              }}
            >✕</button>
          )}
        </div>

        {/* scrollovatelné tělo */}
        <div
          ref={bodyRef}
          onScroll={checkScroll}
          style={{
            overflowY: 'auto', flex: 1, minHeight: 0,
            margin: '14px 0 0', padding: '2px 14px 2px 0',
            borderTop: '1px solid var(--color-line-grid)',
            borderBottom: '1px solid var(--color-line-grid)',
          }}
        >
          {loading && (
            <div style={{ padding: '40px 0', textAlign: 'center', fontFamily: T.inter, fontSize: 13, color: T.ink30 }}>
              Načítám pravidla…
            </div>
          )}
          {(sections ?? []).map((sec, i) => (
            <section key={sec.id ?? i} style={{ padding: '14px 0', borderTop: i > 0 ? '1px solid var(--color-line-grid)' : 'none' }}>
              <h3 style={{
                display: 'flex', alignItems: 'baseline', gap: 8,
                fontFamily: T.sg, fontWeight: 600, fontSize: 13.5, color: T.ink,
                margin: '0 0 8px',
              }}>
                <span style={{ fontFamily: T.mono, fontWeight: 500, fontSize: 11, color: 'var(--color-signal-deep)' }}>
                  {i + 1}.
                </span>
                {sec.title}
              </h3>
              <ul style={{ margin: 0, paddingLeft: 22, display: 'grid', gap: 6 }}>
                {sec.items.map((item, j) => (
                  <li key={j} style={{ fontFamily: T.inter, fontSize: 13, lineHeight: 1.55, color: T.ink50 }}>
                    {item}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        {/* pata */}
        {isAccept ? (
          <div style={{ flexShrink: 0, paddingTop: 12 }}>
            <label style={{
              display: 'flex', alignItems: 'flex-start', gap: 10,
              cursor: readToEnd ? 'pointer' : 'default',
              opacity: readToEnd ? 1 : 0.55,
            }}>
              <input
                type="checkbox"
                checked={agreed}
                disabled={!readToEnd}
                onChange={e => setAgreed(e.target.checked)}
                style={{ width: 16, height: 16, marginTop: 1, accentColor: 'var(--color-signal-deep)', flexShrink: 0 }}
              />
              <span style={{ fontFamily: T.inter, fontSize: 13, lineHeight: 1.4, color: T.ink }}>
                Přečetl(a) jsem pravidla a souhlasím
                {!readToEnd && (
                  <span style={{ display: 'block', fontSize: 11.5, color: T.ink30, marginTop: 2 }}>
                    Doscrollujte na konec pravidel ↓
                  </span>
                )}
              </span>
            </label>

            {error && (
              <p style={{
                fontFamily: T.inter, fontSize: 13, color: T.danger,
                background: 'var(--color-danger-bg)', border: '1px solid var(--color-danger-border)',
                borderRadius: 8, padding: '8px 12px', margin: '10px 0 0',
              }}>
                {error}
              </p>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14 }}>
              <button
                onClick={onClose}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontFamily: T.inter, fontSize: 13, color: T.ink30,
                  padding: '10px 6px', textDecoration: 'underline', textUnderlineOffset: 3,
                }}
              >
                Odhlásit
              </button>
              <button
                onClick={onConfirm}
                disabled={!agreed || confirming}
                style={{
                  ...modalBtn('navy'),
                  opacity: agreed && !confirming ? 1 : 0.45,
                  cursor: agreed && !confirming ? 'pointer' : 'not-allowed',
                }}
              >
                {confirming ? 'Ukládám…' : 'Potvrdit'}
              </button>
            </div>
          </div>
        ) : (
          <div style={{ flexShrink: 0, paddingTop: 14 }}>
            <button
              onClick={onClose}
              style={{ ...modalBtn(), width: '100%' }}
              onMouseEnter={e => (e.currentTarget.style.background = T.base)}
              onMouseLeave={e => (e.currentTarget.style.background = 'none')}
            >
              Zavřít
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
