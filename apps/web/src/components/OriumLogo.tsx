import type { FC } from 'react';

interface OriumLogoProps {
  theme?: 'dark' | 'light';
  className?: string;
}

export const OriumLogo: FC<OriumLogoProps> = ({ theme = 'dark', className = '' }) => {
  const isDark = theme === 'dark';

  return (
    <div className={`orium-brand-logo ${className}`}>
      <svg
        className="orium-logo-mark"
        viewBox="0 0 128 128"
        width="34"
        height="34"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="oriumMarkPurpleGrad" x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#7a1fff" />
            <stop offset="50%" stopColor="#9333ea" />
            <stop offset="100%" stopColor="#a855f7" />
          </linearGradient>
          <filter id="oriumMarkGlow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="2.5" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        {/* Outer Stylized O Loop */}
        <path
          d="M64 12 C35 12, 18 35, 18 64 C18 93, 35 116, 64 116 C93 116, 110 93, 110 64 C110 35, 93 12, 64 12 Z M64 26 C84 26, 96 42, 96 64 C96 86, 84 102, 64 102 C44 102, 32 86, 32 64 C32 42, 44 26, 64 26 Z"
          fill={isDark ? '#f4f4f5' : '#18181b'}
          className="orium-ring-path"
        />

        {/* Inner Diagonal Growth Indicator */}
        <path
          d="M38 90 L88 48 L76 42 L34 82 Z"
          fill="url(#oriumMarkPurpleGrad)"
          filter="url(#oriumMarkGlow)"
        />
      </svg>
      <div className="orium-brand-text">
        <span className="orium-brand-name">ORIUM</span>
        <span className="orium-brand-tagline">SYSTEM</span>
      </div>
    </div>
  );
};
