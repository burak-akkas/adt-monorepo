import type { CoverColor } from "@/lib/board";

// Full class names so Tailwind can see them. A lighter shade in dark mode keeps contrast against the dark surface.
export const coverStyles: Record<CoverColor, string> = {
  red: "bg-red-500 dark:bg-red-400",
  orange: "bg-orange-500 dark:bg-orange-400",
  yellow: "bg-yellow-400 dark:bg-yellow-300",
  green: "bg-green-600 dark:bg-green-400",
  teal: "bg-teal-600 dark:bg-teal-400",
  blue: "bg-blue-500 dark:bg-blue-400",
  purple: "bg-purple-500 dark:bg-purple-400",
  pink: "bg-pink-500 dark:bg-pink-400",
};
