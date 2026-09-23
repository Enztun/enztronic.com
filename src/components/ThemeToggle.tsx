'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useEffect, useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';

export type ThemePreference = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'enztronic-site-theme';
const OPTIONS: { value: ThemePreference; icon: typeof Sun }[] = [
  { value: 'light', icon: Sun },
  { value: 'dark', icon: Moon },
  { value: 'system', icon: Monitor },
];
let sessionPreference: ThemePreference = 'system';

function applyTheme(preference: ThemePreference) {
  const dark =
    preference === 'dark' ||
    (preference === 'system' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

// localStorage is external state, so it is read through useSyncExternalStore
// rather than mirrored into an effect. That keeps the server render and the
// hydrated client render consistent without a "mounted" flag.
const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  const onStorage = () => {
    applyTheme(getSnapshot());
    onChange();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onStorage);
  };
}

function getSnapshot(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : sessionPreference;
  } catch {
    return sessionPreference;
  }
}

function getServerSnapshot(): ThemePreference {
  return 'system';
}

function setPreference(preference: ThemePreference) {
  sessionPreference = preference;
  try { window.localStorage.setItem(STORAGE_KEY, preference); } catch { /* Session preference still works. */ }
  applyTheme(preference);
  for (const listener of listeners) listener();
}

const NEXT_IN_CYCLE: Record<ThemePreference, ThemePreference> = {
  light: 'dark',
  dark: 'system',
  system: 'light',
};

interface ThemeToggleProps {
  className?: string;
  /**
   * Renders a single cycling button instead of three radios. Three 32px
   * targets alongside a wordmark and a menu button overflow a narrow phone
   * header, so the mobile bar uses this form.
   */
  compact?: boolean;
}

export function ThemeToggle({ className = '', compact = false }: ThemeToggleProps) {
  const t = useTranslations('navigationUx');
  const preference = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  useEffect(() => {
    if (preference !== 'system') return;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme('system');
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [preference]);

  if (compact) {
    const active = OPTIONS.find((option) => option.value === preference) ?? OPTIONS[2];
    const ActiveIcon = active.icon;
    const next = NEXT_IN_CYCLE[preference];
    return (
      <button
        type="button"
        onClick={() => setPreference(next)}
        aria-label={t('themeCycle', { current: t(`theme.${active.value}`), next: t(`theme.${next}`) })}
        title={t('themeLabel', { current: t(`theme.${active.value}`) })}
        className={`grid size-11 shrink-0 place-items-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-muted hover:text-brand ${className}`}
      >
        <ActiveIcon aria-hidden="true" className="w-5 h-5" />
      </button>
    );
  }

  return (
    <div
      role="radiogroup"
      aria-label={t('themeGroup')}
      className={`inline-flex items-center gap-0.5 rounded-full border border-line/70 p-0.5 ${className}`}
      onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const index = OPTIONS.findIndex((option) => option.value === preference);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? OPTIONS.length - 1
          : (index + (event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1) + OPTIONS.length) % OPTIONS.length;
        setPreference(OPTIONS[next].value);
        event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
      }}
    >
      {OPTIONS.map(({ value, icon: Icon }) => {
        const isActive = preference === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={isActive}
            aria-label={t(`theme.${value}`)}
            title={t(`theme.${value}`)}
            tabIndex={isActive ? 0 : -1}
            onClick={() => setPreference(value)}
            className={`grid size-9 place-items-center rounded-full transition-colors ${
              isActive
                ? 'bg-brand-fill text-white'
                : 'text-on-surface-variant hover:text-brand'
            }`}
          >
            <Icon aria-hidden="true" className="w-4 h-4" />
          </button>
        );
      })}
    </div>
  );
}

/**
 * Applies the stored theme before first paint, so the page never renders in
 * one palette and snaps to the other.
 */
export function ThemeScript() {
  const source = `(function(){try{var p=localStorage.getItem(${JSON.stringify(
    STORAGE_KEY,
  )})||"system";var d=p==="dark"||(p==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.dataset.theme=d?"dark":"light";}catch(e){document.documentElement.dataset.theme="light";}})();`;
  return <script dangerouslySetInnerHTML={{ __html: source }} />;
}
