"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";

export type ThemePreference = "system" | "light" | "dark";

const STORAGE_KEY = "enztronic-theme";
const OPTIONS: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

function prefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function applyTheme(preference: ThemePreference) {
  const dark = preference === "dark" || (preference === "system" && prefersDark());
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

/**
 * localStorage is external state, so it is read through useSyncExternalStore
 * rather than mirrored into an effect. That keeps the server render ("system")
 * and the hydrated client render consistent without a mounted flag.
 */
const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  // Keeps a second tab in step when the preference changes there.
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function getSnapshot(): ThemePreference {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === "light" || stored === "dark" || stored === "system"
    ? stored
    : "system";
}

function getServerSnapshot(): ThemePreference {
  return "system";
}

function setPreference(preference: ThemePreference) {
  window.localStorage.setItem(STORAGE_KEY, preference);
  applyTheme(preference);
  for (const listener of listeners) listener();
}

export function ThemeToggle() {
  const preference = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  useEffect(() => {
    if (preference !== "system") return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [preference]);

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className="flex items-center gap-1 rounded-xl border border-line bg-canvas/40 p-1"
    >
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const isActive = preference === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={isActive}
            aria-label={label}
            title={label}
            onClick={() => setPreference(value)}
            className={`grid size-8 place-items-center rounded-lg transition-colors ${
              isActive
                ? "bg-accent/15 text-accent ring-1 ring-accent/25"
                : "text-muted hover:bg-panel-raised hover:text-ink"
            }`}
          >
            <Icon aria-hidden="true" className="size-4" />
          </button>
        );
      })}
    </div>
  );
}

/**
 * Applies the stored theme before first paint. Without this the page renders
 * in the default palette and then snaps to the chosen one.
 */
export function ThemeScript() {
  const source = `(function(){try{var p=localStorage.getItem(${JSON.stringify(
    STORAGE_KEY,
  )})||"system";var d=p==="dark"||(p==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.dataset.theme=d?"dark":"light";}catch(e){document.documentElement.dataset.theme="dark";}})();`;
  return <script dangerouslySetInnerHTML={{ __html: source }} />;
}
