"use client";

import * as React from "react";

import {
  readThemePreference,
  resolveThemePreference,
  saveThemePreference,
  serializeThemePreferenceCookie,
  type ResolvedTheme,
  type ThemePreference,
} from "@/lib/theme/theme-preference";

interface ThemeContextValue {
  preference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
}

const ThemeContext = React.createContext<ThemeContextValue | null>(null);

/** `${preference}:${resolvedTheme}`. A string keeps the external-store
 *  snapshot referentially stable across reads. */
type ThemeSnapshot = `${ThemePreference}:${ResolvedTheme}`;

const SERVER_SNAPSHOT: ThemeSnapshot = "system:light";

function systemPrefersDark() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function browserStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function applyTheme(preference: ThemePreference, resolvedTheme: ResolvedTheme) {
  const root = document.documentElement;
  root.classList.toggle("dark", resolvedTheme === "dark");
  root.style.colorScheme = resolvedTheme;
  root.dataset.themePreference = preference;
}

function computeSnapshot(): ThemeSnapshot {
  const preference = readThemePreference(
    browserStorage(),
    document.cookie,
    window.location.hostname,
  );
  return `${preference}:${resolveThemePreference(preference, systemPrefersDark())}`;
}

const listeners = new Set<() => void>();
let snapshot: ThemeSnapshot | null = null;
let mediaQuery: MediaQueryList | null = null;

function publishSnapshot() {
  const next = computeSnapshot();
  if (next === snapshot) return;
  snapshot = next;
  for (const listener of listeners) listener();
}

function subscribeToTheme(listener: () => void) {
  listeners.add(listener);
  if (!mediaQuery) {
    mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    mediaQuery.addEventListener("change", publishSnapshot);
  }

  return () => {
    listeners.delete(listener);
    if (listeners.size > 0 || !mediaQuery) return;
    mediaQuery.removeEventListener("change", publishSnapshot);
    mediaQuery = null;
  };
}

function getThemeSnapshot(): ThemeSnapshot {
  snapshot ??= computeSnapshot();
  return snapshot;
}

function getServerThemeSnapshot(): ThemeSnapshot {
  return SERVER_SNAPSHOT;
}

export function ThemeProvider({ children }: React.PropsWithChildren) {
  const currentSnapshot = React.useSyncExternalStore(
    subscribeToTheme,
    getThemeSnapshot,
    getServerThemeSnapshot,
  );

  const [preference, resolvedTheme] = currentSnapshot.split(":") as [
    ThemePreference,
    ResolvedTheme,
  ];

  React.useEffect(() => {
    applyTheme(preference, resolvedTheme);
  }, [preference, resolvedTheme]);

  const setPreference = React.useCallback((nextPreference: ThemePreference) => {
    saveThemePreference(browserStorage(), nextPreference);
    document.cookie = serializeThemePreferenceCookie(nextPreference, window.location.hostname);
    publishSnapshot();
  }, []);

  const value = React.useMemo(
    () => ({ preference, resolvedTheme, setPreference }),
    [preference, resolvedTheme, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useThemePreference(): ThemeContextValue {
  const context = React.useContext(ThemeContext);
  if (!context) {
    throw new Error("useThemePreference must be used inside ThemeProvider.");
  }
  return context;
}
