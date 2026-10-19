import { useEffect, useState } from 'react';

/**
 * Avisos rápidos de sucesso ("Tarefa iniciada", "Cliente salvo"). Somem sozinhos.
 * Erros e conflitos continuam em banners fixos nas telas, pois exigem atenção.
 */
type Toast = { id: number; message: string };

const TOAST_EVENT = 'orium:toast';
const TOAST_DURATION_MS = 4000;
let nextToastId = 1;

export function showToast(message: string) {
  window.dispatchEvent(new CustomEvent<Toast>(TOAST_EVENT, { detail: { id: nextToastId++, message } }));
}

export function ToastHost() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const timers = new Set<number>();
    const dismiss = (id: number) => setToasts((current) => current.filter((toast) => toast.id !== id));
    const onToast = (event: Event) => {
      const toast = (event as CustomEvent<Toast>).detail;
      setToasts((current) => [...current.slice(-2), toast]);
      const timer = window.setTimeout(() => {
        timers.delete(timer);
        dismiss(toast.id);
      }, TOAST_DURATION_MS);
      timers.add(timer);
    };
    window.addEventListener(TOAST_EVENT, onToast);
    return () => {
      window.removeEventListener(TOAST_EVENT, onToast);
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  return (
    <div className="toast-host" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className="toast">
          <span className="toast-icon" aria-hidden="true">✓</span>
          <span className="toast-message">{toast.message}</span>
          <button
            type="button"
            className="toast-close"
            onClick={() => setToasts((current) => current.filter((t) => t.id !== toast.id))}
            aria-label="Fechar aviso"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
