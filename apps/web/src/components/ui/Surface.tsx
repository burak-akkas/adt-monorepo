import type { HTMLAttributes } from "react";

/** A bordered container on the surface color (summary box, archive panel). */
export function Surface({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={["rounded-xl border border-line bg-surface p-3", className].filter(Boolean).join(" ")}
      {...props}
    />
  );
}
