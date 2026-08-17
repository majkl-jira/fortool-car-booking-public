import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import { AuthShell, Field, PasswordField, AuthButton, InfoBox, ErrorBox } from '../components/auth';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { data } = await api.post('/auth/login', { email, password });
      login(data.token, data.user);
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.message || 'Chyba při přihlášení.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell subtitle="Rezervace vozidel · přihlášení">
      <form onSubmit={handleSubmit} className="mt-6 space-y-3.5">
        <Field
          label="Email"
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="vas@email.cz"
          autoComplete="email"
          required
        />
        <PasswordField
          label="Heslo"
          value={password}
          onChange={e => setPassword(e.target.value)}
          autoComplete="current-password"
        />

        {error && <ErrorBox>{error}</ErrorBox>}

        <AuthButton type="submit" disabled={loading} className="mt-5!">
          {loading ? 'Přihlašuji...' : 'Přihlásit se'}
        </AuthButton>
      </form>

      <div className="flex justify-between mt-4 text-xs">
        <Link to="/forgot-password" className="text-signal-link hover:underline">Zapomenuté heslo</Link>
        <Link to="/register" className="text-signal-link font-semibold hover:underline">Vytvořit účet →</Link>
      </div>

      <div className="mt-5">
        <InfoBox>Nový účet musí schválit správce — přihlásíte se až po schválení.</InfoBox>
      </div>
    </AuthShell>
  );
}
