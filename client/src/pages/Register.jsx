import { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/axios';
import { AuthShell, Field, PasswordField, AuthButton, InfoBox, ErrorBox } from '../components/auth';

export default function Register() {
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', password: '', confirm: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const set = field => e => setForm(f => ({ ...f, [field]: e.target.value }));

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (form.password.length < 8) return setError('Heslo musí mít alespoň 8 znaků.');
    if (form.password !== form.confirm) return setError('Hesla se neshodují.');
    setLoading(true);
    try {
      await api.post('/auth/register', { firstName: form.firstName, lastName: form.lastName, email: form.email, password: form.password });
      setSubmitted(true);
    } catch (err) {
      setError(err.response?.data?.message || 'Chyba při registraci.');
    } finally {
      setLoading(false);
    }
  }

  if (submitted) {
    return (
      <AuthShell subtitle="Nový účet">
        <div className="mt-6 text-center">
          <div className="w-12 h-12 rounded-full bg-success/10 flex items-center justify-center mx-auto mb-5">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--color-success)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
            </svg>
          </div>
          <h2 className="text-lg font-bold text-ink mb-2">Žádost odeslána</h2>
          <p className="text-sm text-ink-50 leading-relaxed mb-6">
            Váš účet musí schválit administrátor.<br />
            Po schválení vás budeme informovat e-mailem.
          </p>
          <Link to="/login" className="inline-block text-xs font-semibold text-signal-link hover:underline">
            ← Zpět na přihlášení
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell subtitle="Nový účet">
      <form onSubmit={handleSubmit} className="mt-5.5 space-y-3.25">
        <div className="grid grid-cols-2 gap-2.5">
          <Field
            label="Jméno"
            type="text"
            value={form.firstName}
            onChange={set('firstName')}
            placeholder="Jan"
            autoComplete="given-name"
            required
          />
          <Field
            label="Příjmení"
            type="text"
            value={form.lastName}
            onChange={set('lastName')}
            placeholder="Novák"
            autoComplete="family-name"
            required
          />
        </div>

        <Field
          label="Email"
          type="email"
          value={form.email}
          onChange={set('email')}
          placeholder="vas@email.cz"
          autoComplete="email"
          required
        />

        <PasswordField
          label="Heslo"
          hint="min. 8 znaků"
          value={form.password}
          onChange={set('password')}
          autoComplete="new-password"
        />

        <PasswordField
          label="Potvrzení hesla"
          value={form.confirm}
          onChange={set('confirm')}
          autoComplete="new-password"
        />

        {error && <ErrorBox>{error}</ErrorBox>}

        <AuthButton type="submit" disabled={loading} className="mt-5!">
          {loading ? 'Odesílám...' : 'Odeslat žádost o účet'}
        </AuthButton>
      </form>

      <p className="mt-3.5 text-center text-xs text-ink-50">
        Máte účet?{' '}
        <Link to="/login" className="text-signal-link font-semibold hover:underline">Přihlásit se</Link>
      </p>

      <div className="mt-4.5">
        <InfoBox variant="note">Po odeslání počká žádost na schválení správcem. Dáme vám vědět emailem.</InfoBox>
      </div>
    </AuthShell>
  );
}
