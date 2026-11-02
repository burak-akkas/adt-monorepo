"use client";

import { useEffect } from "react";
import { createPreferenceStore } from "@/hooks/createPreferenceStore";
import { loadTheme, resolveTheme, saveTheme, THEME_KEY, type ThemePreference } from "@/lib/theme";

const DARK_QUERY = "(prefers-color-scheme: dark)";

// Server snapshot is "system", so the static export hydrates without a mismatch.
const store = createPreferenceStore<ThemePreference>({
  key: THEME_KEY,
  load: loadTheme,
  save: saveTheme,
  serverValue: "system",
});

export function useTheme() {
  const [preference, setPreference] = store.useValue();

  useEffect(() => {
    const media = window.matchMedia(DARK_QUERY);
    const apply = () => {
      document.documentElement.dataset.theme = resolveTheme(preference, media.matches);
    };
    apply();
    if (preference !== "system") return;
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [preference]);

  return [preference, setPreference] as const;
}

// Tests only: forget the cached preference so the next read comes from storage.
export const resetThemeStore = store.reset;
