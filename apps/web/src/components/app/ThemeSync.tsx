"use client";

import { useTheme } from "@/hooks/useTheme";

// Applies the saved theme (and follows the OS for "System") on every page load,
// whether or not the Settings dialog that holds the switch is open.
export function ThemeSync() {
  useTheme();
  return null;
}
