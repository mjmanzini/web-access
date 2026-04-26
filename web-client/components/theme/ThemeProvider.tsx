'use client';

/**
 * ThemeProvider — light / dark / system, persisted in localStorage.
 * Sets `data-theme` on <html>; CSS variables in globals.css react to it.
 */
import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
} from 'react';

export type Theme = 'light' | 'dark' | 'system';
type Resolved = 'light' | 'dark';

interface Ctx {
  theme: Theme;
  resolved: Resolved;
  setTheme: (t: Theme) => void;
  cycle: () => void;
}

const ThemeCtx = createContext<Ctx | null>(null);
const STORAGE_KEY = 'web-access:theme';

function readSystem(): Resolved {
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('system');
  const [resolved, setResolved] = useState<Resolved>('dark');

  // initial read (client-only to avoid hydration mismatch)
  useEffect(() => {
    const stored = (typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY)) as Theme | null;
    const initial: Theme = stored ?? 'system';
    setThemeState(initial);
  }, []);

  // resolve + apply
  useEffect(() => {
    const apply = () => {
      const r: Resolved = theme === 'system' ? readSystem() : theme;
      setResolved(r);
      document.documentElement.setAttribute('data-theme', r);
    };
    apply();
    if (theme === 'system' && typeof window !== 'undefined') {
      const mq = window.matchMedia('(prefers-color-scheme: light)');
      mq.addEventListener('change', apply);
      return () => mq.removeEventListener('change', apply);
    }
  }, [theme]);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    try { localStorage.setItem(STORAGE_KEY, t); } catch {}
  }, []);

  const cycle = useCallback(() => {
    setTheme(theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light');
  }, [theme, setTheme]);

  const value = useMemo(() => ({ theme, resolved, setTheme, cycle }), [theme, resolved, setTheme, cycle]);
  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export function useTheme(): Ctx {
  const v = useContext(ThemeCtx);
  if (!v) throw new Error('useTheme outside ThemeProvider');
  return v;
}

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, cycle } = useTheme();
  const label = theme === 'light' ? '☀︎ Light' : theme === 'dark' ? '☾ Dark' : '⌘ System';
  return (
    <button className={className ?? 'theme-toggle'} onClick={cycle} aria-label={`Theme: ${theme}`}>
      {label}
    </button>
  );
}
