import type { FC } from 'react';
import logoHorizontal from '../assets/logo-horizontal.png';
import logoHorizontalLight from '../assets/logo-horizontal-light-theme.png';

interface OriumLogoProps {
  theme?: 'dark' | 'light';
  className?: string;
}

export const OriumLogo: FC<OriumLogoProps> = ({ theme = 'dark', className = '' }) => {
  const isDark = theme === 'dark';

  return (
    <div className={`orium-brand-logo ${className}`}>
      <img
        src={isDark ? logoHorizontal : logoHorizontalLight}
        alt="Orium System"
        className="orium-header-logo"
        height="34"
      />
    </div>
  );
};
