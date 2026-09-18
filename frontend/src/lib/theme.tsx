// Dark/light theme — one tiny store, no dependencies.
//
//   * Mode is remembered in localStorage ('light' | 'dark'); with no stored
//     choice the OS preference wins (prefers-color-scheme) and keeps being
//     followed until the user explicitly picks a side.
//   * Theme is applied as a `dark` class on <html>, which Tailwind's
//     `darkMode: 'class'` turns into the dark: variant — and which the
//     hand-written dark overrides in index.css key off.
//   * The browser UI (address bar / status bar) follows along via the
//     theme-color meta tag, updated here so it never fights the app.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

export type ThemeMode = 'light' | 'dark';

const STORAGE_KEY = 'rpms-theme';

// Browser chrome background, kept in step with the app surface.
const THEME_COLOR: Record<ThemeMode, string> = {
  light: '#f9fafb',
  dark: '#0f172a',
};

export function storedTheme(): ThemeMode | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null; // storage blocked (private mode) — fall back to system
  }
}

export function systemTheme(): ThemeMode {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

export function currentTheme(): ThemeMode {
  return storedTheme() ?? systemTheme();
}

export function applyTheme(mode: ThemeMode): void {
  document.documentElement.classList.toggle('dark', mode === 'dark');
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
  }
  meta.content = THEME_COLOR[mode];
}

interface ThemeContextValue {
  theme: ThemeMode;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeMode>(() => currentTheme());

  // Apply on mount and on every change (including system-driven flips while
  // running without an explicit user choice).
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (storedTheme()) return; // explicit choice — ignore the OS
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setTheme(e.matches ? 'dark' : 'light');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const toggle = useCallback(() => {
    setTheme((prev) => {
      const next: ThemeMode = prev === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // storage blocked — theme still applies for this session
      }
      return next;
    });
  }, []);

  const value = useMemo(() => ({ theme, toggle }), [theme, toggle]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
