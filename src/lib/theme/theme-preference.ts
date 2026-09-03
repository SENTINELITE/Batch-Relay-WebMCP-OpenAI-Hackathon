export const THEME_PREFERENCE_STORAGE_KEY = "batchrelay-theme-preference";
export const THEME_PREFERENCE_COOKIE_KEY = THEME_PREFERENCE_STORAGE_KEY;

export const THEME_PREFERENCES = ["system", "light", "dark"] as const;

export type ThemePreference = (typeof THEME_PREFERENCES)[number];
export type ResolvedTheme = Exclude<ThemePreference, "system">;

export interface ThemeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === "string" && THEME_PREFERENCES.includes(value as ThemePreference);
}

export function parseThemePreference(value: unknown): ThemePreference | null {
  return isThemePreference(value) ? value : null;
}

export function resolveThemePreference(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (preference === "system") {
    return systemPrefersDark ? "dark" : "light";
  }

  return preference;
}

export function readThemePreference(
  storage: Pick<ThemeStorage, "getItem"> | null | undefined,
  cookie = "",
  hostname = "",
): ThemePreference {
  let storedPreference: ThemePreference | null = null;

  try {
    storedPreference = parseThemePreference(storage?.getItem(THEME_PREFERENCE_STORAGE_KEY));
  } catch {
    // Private browsing or storage policy should fall through to the cookie.
  }

  const cookiePreference = readThemePreferenceCookie(cookie);

  return themeCookieDomain(hostname)
    ? cookiePreference ?? storedPreference ?? "system"
    : storedPreference ?? cookiePreference ?? "system";
}

export function saveThemePreference(
  storage: Pick<ThemeStorage, "setItem"> | null | undefined,
  preference: ThemePreference,
): void {
  try {
    storage?.setItem(THEME_PREFERENCE_STORAGE_KEY, preference);
  } catch {
    // Private browsing or storage policy should not prevent theme selection.
  }
}

export function themeCookieDomain(hostname: string): string | undefined {
  const normalizedHostname = hostname.trim().toLowerCase().replace(/\.$/, "");

  return normalizedHostname === "batchrelay.com" || normalizedHostname.endsWith(".batchrelay.com")
    ? ".batchrelay.com"
    : undefined;
}

export function readThemePreferenceCookie(cookie: string): ThemePreference | null {
  const entry = cookie
    .split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${THEME_PREFERENCE_COOKIE_KEY}=`));

  return parseThemePreference(entry?.slice(THEME_PREFERENCE_COOKIE_KEY.length + 1));
}

export function serializeThemePreferenceCookie(
  preference: ThemePreference,
  hostname: string,
): string {
  const domain = themeCookieDomain(hostname);
  const domainAttribute = domain ? `; Domain=${domain}` : "";

  return `${THEME_PREFERENCE_COOKIE_KEY}=${preference}; Path=/; Max-Age=31536000; SameSite=Lax${domainAttribute}`;
}

export const themePreferenceBootstrapScript = `(() => {
  const key = "${THEME_PREFERENCE_STORAGE_KEY}";
  const preferences = { system: true, light: true, dark: true };
  const cookieValue = document.cookie.split("; ").find((entry) => entry.startsWith(key + "="))?.split("=")[1];
  const hostname = window.location.hostname.trim().toLowerCase().replace(/\\.$/, "");
  const hasSharedCookieDomain = hostname === "batchrelay.com" || hostname.endsWith(".batchrelay.com");
  let storedValue;
  try { storedValue = localStorage.getItem(key); } catch {}
  const storedPreference = preferences[storedValue] ? storedValue : undefined;
  const cookiePreference = preferences[cookieValue] ? cookieValue : undefined;
  const preference = hasSharedCookieDomain
    ? cookiePreference || storedPreference || "system"
    : storedPreference || cookiePreference || "system";
  const isDark = preference === "dark" || (preference === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", isDark);
  document.documentElement.style.colorScheme = isDark ? "dark" : "light";
  document.documentElement.dataset.themePreference = preference;
})();`;
