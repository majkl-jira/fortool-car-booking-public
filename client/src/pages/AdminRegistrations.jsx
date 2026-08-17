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
  gold:    'var(--color-warn)',
  danger:  'var(--color-danger)',
  sg:      'var(--font-sg)',
  inter:   'var(--font-sg)',   // Inter vyřazen — sjednoceno na Space Grotesk
  mono:    'var(--font-mono)', // IBM Plex Mono
  manrope: 'var(--font-sg)',   // Manrope vyřazen — sjednoceno na Space Grotesk
};

function pluralZadost(n) {
  if (n === 1) return 'žádost';
  if (n >= 2 && n <= 4) return 'žádosti';
  return 'žádostí';
}

export default function AdminRegistrations() {
  const { user, pendingCount, setPendingCount } = useAuth();
  const navigate = useNavigate();

  const [activeTab,   setActiveTab]   = useState('pending');
  const [pending,     setPending]     = useState([]);
  const [rejected,    setRejected]    = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [loadError,   setLoadError]   = useState(false);
  const [actionBusy,  setActionBusy]  = useState({});
  const [rowError,    setRowError]    = useState({});
  const [toast,       setToast]       = useState(null);

  useEffect(() => {
    if (activeTab === 'pending') fetchPending();
    else fetchRejected();
  }, [activeTab]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  async function fetchPending() {
    setLoading(true);
    setLoadError(false);
    try {
      const { data } = await api.get('/admin/registrations/pending');
      setPending(data);
      setPendingCount(data.length); // badge = čerstvý seznam (jinak drží snapshot z Dashboardu)
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }

  async function fetchRejected() {
    setLoading(true);
    setLoadError(false);
    try {
      const { data } = await api.get('/admin/registrations/rejected');
      setRejected(data);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }

  function retryFetch() {
    if (activeTab === 'pending') fetchPending();
    else fetchRejected();
  }

  async function handleAction(id, action, tab) {
    setActionBusy(b => ({ ...b, [id]: true }));
    setRowError(e => ({ ...e, [id]: '' }));
    try {
      await api.post(`/admin/registrations/${id}/${action}`);
      if (tab === 'pending') {
        setPending(p => p.filter(u => u.id !== id));
        setPendingCount(c => Math.max(0, (c ?? 1) - 1));
        setToast({ msg: action === 'approve' ? 'Registrace schválena.' : 'Registrace zamítnuta.', ok: action === 'approve' });
      } else {
        setRejected(r => r.filter(u => u.id !== id));
        setToast({ msg: 'Registrace obnovena.', ok: true });
      }
    } catch (err) {
      const msg = err.response?.data?.message || 'Akce se nezdařila.';
      setRowError(e => ({ ...e, [id]: msg }));
      if (err.response?.status === 409) {
        if (tab === 'pending') fetchPending();
        else fetchRejected();
      }
    } finally {
      setActionBusy(b => ({ ...b, [id]: false }));
    }
  }

  const initials = user
    ? `${user.firstName[0]}${user.lastName[0]}`.toUpperCase()
    : '?';

  const currentList = activeTab === 'pending' ? pending : rejected;

  return (
    <div style={{ minHeight: '100vh', background: T.base, fontFamily: T.inter }}>

      {/* ── HEADER (světlý — dle handoffu) ──────────────────────────────────────── */}
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
            Správa registrací
          </span>
        </div>

        {/* Avatar — bez tečky počtu (počet nese badge na tabu) */}
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

        {/* Taby + počet */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{
            display: 'flex', background: T.field,
            border: '1px solid var(--color-input)', borderRadius: 10,
            overflow: 'hidden', fontSize: 12, fontWeight: 600,
          }}>
            {[['pending', 'Čekající'], ['rejected', 'Zamítnuté']].map(([k, label]) => {
              const active = activeTab === k;
              return (
                <button
                  key={k}
                  onClick={() => setActiveTab(k)}
                  aria-pressed={active}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 7,
                    fontFamily: T.sg, fontSize: 12, fontWeight: 600,
                    color: active ? '#fff' : T.ink50,
                    background: active ? T.ink : T.field,
                    border: 'none', cursor: 'pointer',
                    padding: '8px 16px',
                    transition: 'color .15s, background .15s',
                  }}
                >
                  {label}
                  {k === 'pending' && pendingCount > 0 && (
                    <span style={{
                      fontFamily: T.mono, fontSize: 10, fontWeight: 600,
                      minWidth: 17, height: 17, padding: '0 4px',
                      background: active ? T.signal : T.line,
                      color: active ? '#fff' : T.ink50,
                      borderRadius: 9,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {pendingCount > 9 ? '9+' : pendingCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {!loading && !loadError && (
            <span style={{ fontFamily: T.mono, fontWeight: 500, fontSize: 11, color: T.ink30, flexShrink: 0 }}>
              {currentList.length} {pluralZadost(currentList.length)}
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
              onClick={retryFetch}
              style={{
                fontFamily: T.inter, fontSize: 13, color: 'var(--color-signal-link)',
                background: 'none', border: '1px solid var(--color-input)', borderRadius: 8,
                cursor: 'pointer', padding: '6px 16px',
              }}
            >
              Zkusit znovu
            </button>
          </div>
        ) : currentList.length === 0 ? (
          /* Prázdný stav — čárkovaný rámeček dle handoffu */
          <div style={{
            background: T.field, border: '1px dashed var(--color-input)',
            borderRadius: 12, padding: 28, textAlign: 'center',
          }}>
            <div style={{ fontFamily: T.sg, fontSize: 13, fontWeight: 700, color: T.ink }}>
              {activeTab === 'pending' ? 'Žádné čekající registrace.' : 'Žádné zamítnuté registrace.'}
            </div>
            <div style={{ fontFamily: T.inter, fontSize: 12, color: T.ink30, marginTop: 4 }}>
              {activeTab === 'pending'
                ? 'Nové žádosti se zobrazí zde po registraci uživatele.'
                : 'Zamítnuté registrace se zobrazí zde.'}
            </div>
          </div>
        ) : (
          <div style={{ background: T.field, border: `1px solid ${T.line}`, borderRadius: 12, overflow: 'hidden' }}>
            {currentList.map((u, i) => {
              const isLast     = i === currentList.length - 1;
              const busy       = actionBusy[u.id];
              const rowErr     = rowError[u.id];
              const reg        = parseISO(u.createdAt);
              const isRejected = activeTab === 'rejected';

              return (
                <div key={u.id} style={{ borderBottom: isLast ? 'none' : '1px solid var(--color-line-row)' }}>
                  <div className="admin-row" style={{
                    display: 'flex', alignItems: 'center', gap: 16,
                    padding: '16px 20px', flexWrap: 'wrap',
                  }}>
                    {/* Avatar */}
                    <div style={{
                      width: 38, height: 38, borderRadius: 10, flexShrink: 0,
                      background: isRejected ? 'var(--color-danger-bg)' : 'var(--color-line-grid)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontFamily: T.mono, fontWeight: 600, fontSize: 12,
                      color: isRejected ? T.danger : T.ink50,
                    }}>
                      {u.firstName[0]}{u.lastName[0]}
                    </div>

                    {/* Info */}
                    <div style={{ flex: 1, minWidth: 180 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontFamily: T.sg, fontWeight: 700, fontSize: 14, color: T.ink }}>
                          {u.firstName} {u.lastName}
                        </span>
                        {isRejected && (
                          <span style={{
                            fontFamily: T.mono, fontWeight: 600, fontSize: 9,
                            letterSpacing: '0.08em', padding: '2px 6px',
                            background: 'var(--color-danger-bg)',
                            border: '1px solid var(--color-danger-border)',
                            borderRadius: 4, color: T.danger,
                          }}>
                            ZAMÍTNUTO
                          </span>
                        )}
                      </div>
                      <div style={{ fontFamily: T.mono, fontSize: 11, color: T.ink30, marginTop: 2 }}>
                        {u.email} · žádost {format(reg, 'dd.MM')} {reg.getHours()}:{String(reg.getMinutes()).padStart(2, '0')}
                      </div>
                    </div>

                    {/* Actions */}
                    {activeTab === 'pending' ? (
                      <div className="admin-actions" style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                        <button
                          onClick={() => handleAction(u.id, 'reject', 'pending')}
                          disabled={busy}
                          style={{
                            height: 34, padding: '0 16px',
                            background: T.field, color: T.danger,
                            fontFamily: T.sg, fontSize: 12, fontWeight: 600,
                            border: '1px solid var(--color-input)', borderRadius: 8,
                            cursor: busy ? 'default' : 'pointer',
                            opacity: busy ? .6 : 1, transition: 'background .15s, opacity .15s',
                          }}
                          onMouseEnter={e => { if (!busy) e.currentTarget.style.background = 'var(--color-danger-bg)'; }}
                          onMouseLeave={e => { e.currentTarget.style.background = T.field; }}
                        >
                          Zamítnout
                        </button>
                        <button
                          onClick={() => handleAction(u.id, 'approve', 'pending')}
                          disabled={busy}
                          style={{
                            height: 34, padding: '0 16px',
                            background: T.free, color: '#fff',
                            fontFamily: T.sg, fontSize: 12, fontWeight: 700,
                            border: 'none', borderRadius: 8,
                            cursor: busy ? 'default' : 'pointer',
                            opacity: busy ? .6 : 1, transition: 'background .15s, opacity .15s',
                          }}
                          onMouseEnter={e => { if (!busy) e.currentTarget.style.background = 'var(--color-success-hover)'; }}
                          onMouseLeave={e => { e.currentTarget.style.background = T.free; }}
                        >
                          Schválit
                        </button>
                      </div>
                    ) : (
                      <div className="admin-actions" style={{ display: 'flex', flexShrink: 0 }}>
                        <button
                          onClick={() => handleAction(u.id, 'approve', 'rejected')}
                          disabled={busy}
                          style={{
                            height: 34, padding: '0 16px',
                            background: 'var(--color-signal-bg)',
                            color: 'var(--color-signal-link)',
                            fontFamily: T.sg, fontSize: 12, fontWeight: 700,
                            border: '1px solid var(--color-signal-border)', borderRadius: 8,
                            cursor: busy ? 'default' : 'pointer',
                            opacity: busy ? .6 : 1, transition: 'opacity .15s',
                          }}
                        >
                          ↺ Obnovit žádost
                        </button>
                      </div>
                    )}
                  </div>

                  {rowErr && (
                    <div style={{
                      margin: '0 20px 12px',
                      padding: '8px 12px',
                      background: 'var(--color-danger-bg)', border: '1px solid var(--color-danger-border)',
                      borderRadius: 8, fontFamily: T.inter, fontSize: 13, color: T.danger,
                    }}>
                      {rowErr}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

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
          .admin-actions { width: 100%; }
          .admin-actions button { flex: 1; height: 44px !important; }
        }
        @media (prefers-reduced-motion: reduce) {
          * { animation-duration: 0.01ms !important; }
        }
      `}</style>
    </div>
  );
}
