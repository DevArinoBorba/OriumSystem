import { useState } from 'react';
import type { FormEvent, RefObject } from 'react';
import { loginSchema, type SessionResponse } from '@orium/contracts';
import { api, ApiError } from '../api.js';
import { useTheme } from '../theme.js';
import { PasswordVisibilityButton } from './PasswordVisibilityButton.js';
import logoHorizontal from '../assets/logo-horizontal.png';
import logoHorizontalLight from '../assets/logo-horizontal-light-theme.png';

interface LoginViewProps {
  onSuccess: (session: SessionResponse) => void;
  activeRequestRef: RefObject<AbortController | null>;
}

export function LoginView({ onSuccess, activeRequestRef }: LoginViewProps) {
  const [theme, , toggleTheme] = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage('');

    const input = loginSchema.safeParse({ email, password });
    if (!input.success) {
      setMessage('Confira o e-mail e a senha e tente novamente.');
      setPassword('');
      setShowPassword(false);
      return;
    }

    const controller = new AbortController();
    activeRequestRef.current = controller;
    setBusy(true);

    try {
      const session = await api.signIn(input.data, controller.signal);
      onSuccess(session);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      if (error instanceof ApiError && error.code === 'RATE_LIMITED') {
        setMessage('Muitas tentativas consecutivas. Aguarde um minuto e tente novamente.');
      } else {
        setMessage('Não foi possível entrar. Confira suas credenciais e tente novamente.');
      }
    } finally {
      setPassword('');
      setShowPassword(false);
      setBusy(false);
      if (activeRequestRef.current === controller) {
        activeRequestRef.current = null;
      }
    }
  }

  return (
    <main className="shell">
      <section className="card" aria-labelledby="login-title">
        <div className="login-card-header">
          <div className="login-brand-wrapper">
            <img
              src={theme === 'dark' ? logoHorizontal : logoHorizontalLight}
              alt="Orium Digital"
              className="login-brand-logo"
              height="36"
            />
            <p className="eyebrow">OriumSystem</p>
          </div>
          <button
            type="button"
            className="theme-toggle-button login-theme-toggle"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Alternar para tema claro' : 'Alternar para tema escuro'}
            title={theme === 'dark' ? 'Alternar para tema claro' : 'Alternar para tema escuro'}
          >
            {theme === 'dark' ? (
              <svg
                className="theme-icon"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="5" />
                <line x1="12" y1="1" x2="12" y2="3" />
                <line x1="12" y1="21" x2="12" y2="23" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                <line x1="1" y1="12" x2="3" y2="12" />
                <line x1="21" y1="12" x2="23" y2="12" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </svg>
            ) : (
              <svg
                className="theme-icon"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            )}
          </button>
        </div>
        <h1 id="login-title">Entrar</h1>
        <p className="muted">Acesse sua conta da equipe.</p>
        <form onSubmit={(event) => void handleSubmit(event)} noValidate>
          <label htmlFor="email">E-mail</label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            inputMode="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            disabled={busy}
          />
          <label htmlFor="password">Senha</label>
          <div className="password-field">
            <input
              id="password"
              name="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              disabled={busy}
            />
            <PasswordVisibilityButton
              visible={showPassword}
              onToggle={() => setShowPassword((current) => !current)}
              disabled={busy}
            />
          </div>
          {message && (
            <p className="notice" role="alert">
              {message}
            </p>
          )}
          <button type="submit" disabled={busy}>
            {busy ? 'Entrando…' : 'Entrar'}
          </button>
          {busy && (
            <button
              className="cancel"
              type="button"
              onClick={() => activeRequestRef.current?.abort()}
            >
              Cancelar
            </button>
          )}
        </form>
      </section>
    </main>
  );
}
