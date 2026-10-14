import { useState } from 'react';
import type { FormEvent, RefObject } from 'react';
import { loginSchema, type SessionResponse } from '@orium/contracts';
import { api, ApiError } from '../api.js';
import { PasswordVisibilityButton } from './PasswordVisibilityButton.js';

interface LoginViewProps {
  onSuccess: (session: SessionResponse) => void;
  activeRequestRef: RefObject<AbortController | null>;
}

export function LoginView({ onSuccess, activeRequestRef }: LoginViewProps) {
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
        <p className="eyebrow">OriumSystem</p>
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
            <PasswordVisibilityButton visible={showPassword} onToggle={() => setShowPassword((current) => !current)} disabled={busy} />
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
