"use client";

import type { ThemePreference } from "@/lib/theme";
import { useTheme } from "@/hooks/useTheme";

const OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export function ThemeToggle() {
  const [preference, setPreference] = useTheme();

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="inline-flex shrink-0 self-start rounded-lg border border-field bg-surface p-0.5 text-sm"
    >
      {OPTIONS.map(({ value, label }) => (
        <label
          key={value}
          className="relative cursor-pointer rounded-md px-3 py-1 text-subtle has-[:checked]:bg-inverse has-[:checked]:text-on-inverse has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent"
        >
          <input
            type="radio"
            name="theme"
            value={value}
            checked={preference === value}
            onChange={() => setPreference(value)}
            className="absolute inset-0 cursor-pointer opacity-0"
          />
          {label}
        </label>
      ))}
    </div>
  );
}
