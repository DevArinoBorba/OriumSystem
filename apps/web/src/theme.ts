import { useState, useEffect } from 'react';

export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'orium-theme';
const THEME_CHANGE_EVENT = 'orium-theme-change';

export function getInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'dark';
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

export function applyTheme(theme: Theme): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
    document.documentElement.dataset.theme = theme;
    window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: theme }));
  } catch {
    document.documentElement.dataset.theme = theme;
  }
}

export function useTheme(): [Theme, (theme: Theme) => void, () => void] {
  const [theme, setLocalTheme] = useState<Theme>(getInitialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;

    function handleThemeChange(event: Event) {
      const customEvent = event as CustomEvent<Theme>;
      if (customEvent.detail) {
        setLocalTheme(customEvent.detail);
      } else {
        setLocalTheme(getInitialTheme());
      }
    }

    function handleStorage(event: StorageEvent) {
      if (event.key === STORAGE_KEY) {
        const next = getInitialTheme();
        setLocalTheme(next);
        document.documentElement.dataset.theme = next;
      }
    }

    window.addEventListener(THEME_CHANGE_EVENT, handleThemeChange);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener(THEME_CHANGE_EVENT, handleThemeChange);
      window.removeEventListener('storage', handleStorage);
    };
  }, [theme]);

  const toggleTheme = () => {
    const nextTheme: Theme = theme === 'dark' ? 'light' : 'dark';
    applyTheme(nextTheme);
    setLocalTheme(nextTheme);
  };

  const updateTheme = (newTheme: Theme) => {
    applyTheme(newTheme);
    setLocalTheme(newTheme);
  };

  return [theme, updateTheme, toggleTheme];
}
