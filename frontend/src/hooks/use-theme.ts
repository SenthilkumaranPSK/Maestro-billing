import { useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'maestro-billing:theme';

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

function readStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'dark' || stored === 'light') return stored;
  } catch {
    // localStorage unavailable (private browsing, storage disabled) — fall
    // through to the default below.
  }
  return 'light';
}

/**
 * Whole-app light/dark theme, persisted per-machine (localStorage) — this is
 * a single-trusted-operator local app, not a multi-user product, so a
 * per-PC preference is all that's needed. index.html applies the stored
 * class synchronously before React mounts (avoids a light-mode flash on
 * load); this hook keeps that in sync afterwards for the Settings toggle.
 */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(readStoredTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setTheme = (next: Theme) => {
    setThemeState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // best-effort — theme still applies for this session even if it can't persist
    }
  };

  return { theme, setTheme };
}
