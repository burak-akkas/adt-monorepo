import { defaultStorage, readPreference, writePreference } from "@/lib/preference";

export const THEME_KEY = "kanban-theme-v1";

export type ThemePreference = "system" | "light" | "dark";

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

export function loadTheme(storage = defaultStorage()): ThemePreference {
  return readPreference(THEME_KEY, (raw) => (isThemePreference(raw) ? raw : "system"), "system", storage);
}

export function saveTheme(preference: ThemePreference, storage = defaultStorage()): void {
  writePreference(THEME_KEY, preference, storage);
}

export function resolveTheme(preference: ThemePreference, systemDark: boolean): "light" | "dark" {
  if (preference === "system") return systemDark ? "dark" : "light";
  return preference;
}
