import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import api from '../api/axios';
import { AuthShell, FieldLabel, PasswordField, AuthButton, ErrorBox } from '../components/auth';

export default function ResetPassword() {
  const [form, setForm] = useState({ code: '', newPassword: '', confirm: '' });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const [searchParams] = useSearchParams();
  const email = searchParams.get('email') || '';
  const navigate = useNavigate();

  const set = field => e => setForm(f => ({ ...f, [field]: e.target.value }));

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (form.newPassword.length < 8) return setError('Heslo musí mít alespoň 8 znaků.');
    if (form.newPassword !== form.confirm) return setError('Hesla se neshodují.');
    setLoading(true);
    try {
      await api.post('/auth/reset-password', { email, code: form.code, newPassword: form.newPassword });
      setSuccess(true);
    } catch (err) {
      setError(err.response?.data?.message || 'Nepodařilo se resetovat heslo.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell subtitle="Reset hesla · nové heslo">
      {success ? (
        <div className="mt-5">
          <div className="h-px bg-line mb-5" />
          <p className="text-sm text-ink font-semibold mb-1">Heslo bylo změněno</p>
          <p className="text-[12.5px] leading-normal text-ink-50 mb-5">Nyní se můžete přihlásit novým heslem.</p>
          <AuthButton onClick={() => navigate('/login')}>
            Přejít na přihlášení
          </AuthButton>
        </div>
      ) : (
        <>
          <p className="mt-5 text-[12.5px] leading-normal text-ink-50">
            Zadejte kód z e-mailu a zvolte si nové heslo.
          </p>
          <form onSubmit={handleSubmit} className="mt-4 space-y-3.5">
            <div>
              <FieldLabel>Kód z e-mailu</FieldLabel>
              <input
                type="text"
                inputMode="numeric"
                value={form.code}
                onChange={e => setForm(f => ({ ...f, code: e.target.value.replace(/\D/g, '').slice(0, 6) }))}
                className="w-full box-border h-12.5 px-3.5 text-center font-mono font-semibold text-lg tracking-[0.5em] text-ink bg-input-bg border border-input rounded-[10px] focus:outline-none focus:border-signal transition-colors placeholder-ink-30"
                placeholder="000000"
                maxLength={6}
                required
              />
            </div>

            <PasswordField
              label="Nové heslo"
              hint="min. 8 znaků"
              value={form.newPassword}
              onChange={set('newPassword')}
              autoComplete="new-password"
            />

            <PasswordField
              label="Potvrzení nového hesla"
              value={form.confirm}
              onChange={set('confirm')}
              autoComplete="new-password"
            />

            {error && <ErrorBox>{error}</ErrorBox>}

            <AuthButton type="submit" disabled={loading || form.code.length !== 6} className="mt-4.5!">
              {loading ? 'Ukládám...' : 'Nastavit nové heslo'}
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
