import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../api/axios';
import { AuthShell, Field, AuthButton } from '../components/auth';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post('/auth/forgot-password', { email });
    } catch {
      // vždy success – server neodhaluje existenci emailu
    } finally {
      setLoading(false);
      setSent(true);
    }
  }

  return (
    <AuthShell subtitle="Reset hesla">
      {sent ? (
        <div className="mt-5">
          <div className="h-px bg-line mb-5" />
          <p className="text-sm text-ink font-semibold mb-1">Email odeslán</p>
          <p className="text-[12.5px] leading-normal text-ink-50 mb-5">
            Pokud účet existuje, obdržíte kód pro reset hesla. Zkontrolujte svou schránku.
          </p>
          <AuthButton onClick={() => navigate(`/reset-password?email=${encodeURIComponent(email)}`)}>
            Zadat kód →
          </AuthButton>
        </div>
      ) : (
        <>
          <p className="mt-5 text-[12.5px] leading-normal text-ink-50">
            Zadejte email a pošleme vám kód pro nastavení nového hesla.
          </p>
          <form onSubmit={handleSubmit} className="mt-4">
            <Field
              label="Email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="vas@email.cz"
              autoComplete="email"
              required
            />
            <AuthButton type="submit" disabled={loading} className="mt-4.5">
              {loading ? 'Odesílám...' : 'Odeslat kód'}
            </AuthButton>
          </form>
        </>
      )}

      <p className="mt-4 text-center text-xs">
        <Link to="/login" className="text-signal-link hover:underline">← Zpět na přihlášení</Link>
      </p>
    </AuthShell>
  );
}
