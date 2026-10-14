interface PasswordVisibilityButtonProps {
  visible: boolean;
  onToggle: () => void;
  disabled?: boolean;
}

export function PasswordVisibilityButton({ visible, onToggle, disabled = false }: PasswordVisibilityButtonProps) {
  const label = visible ? 'Ocultar senha' : 'Mostrar senha';

  return (
    <button
      className="password-visibility"
      type="button"
      aria-label={label}
      aria-pressed={visible}
      title={label}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onToggle}
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {visible ? (
          <>
            <path d="M3 3l18 18" />
            <path d="M10.6 10.6a2 2 0 002.8 2.8" />
            <path d="M9.9 5.2A10.8 10.8 0 0112 5c5.2 0 8.8 4.3 10 7-.5 1.2-1.5 2.6-2.9 3.8M6.2 6.2C4.1 7.5 2.7 9.5 2 12c1.2 2.7 4.8 7 10 7 1 0 2-.2 2.9-.5" />
          </>
        ) : (
          <>
            <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
            <circle cx="12" cy="12" r="3" />
          </>
        )}
      </svg>
    </button>
  );
}
