"use client";

import { useRef, type ReactNode } from "react";
import { wipStatus } from "@/lib/board";
import { Button, ChevronIcon } from "@/components/ui";

interface ColumnHeaderProps {
  id: string;
  title: string;
  // The real (unfiltered) number of cards in the column.
  total: number;
  limit: number | undefined;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  // Set for the board's designated in-progress or done list (see the Insights panel).
  role?: "doing" | "done";
  // The real number of overdue cards in the column; the badge is hidden at 0.
  overdue?: number;
  children?: ReactNode;
}

export function ColumnHeader({
  id,
  title,
  total,
  limit,
  collapsed,
  onToggleCollapsed,
  role,
  overdue = 0,
  children,
}: ColumnHeaderProps) {
  const toggleRef = useRef<HTMLButtonElement>(null);
  const status = wipStatus(total, limit);

  const badgeTone =
    status.state === "over"
      ? "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200"
      : status.state === "at"
        ? "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
        : "bg-line text-subtle";

  // The header remounts as a different tree, so focus goes back to the button after the toggle.
  function toggle() {
    onToggleCollapsed();
    requestAnimationFrame(() => toggleRef.current?.focus());
  }

  const roleMarker = role && (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 text-xs font-medium ${
        role === "done"
          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
          : "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200"
      }`}
    >
      {role === "done" && <span aria-hidden="true">✓</span>}
      {role === "done" ? "Done list" : "In progress list"}
    </span>
  );

  const overdueBadge = overdue > 0 && (
    <span className="rounded-full bg-red-100 px-2 text-xs font-medium text-red-800 dark:bg-red-950 dark:text-red-200">
      {overdue} overdue
    </span>
  );

  const toggleLabel =`${collapsed ? "Expand" : "Collapse"} ${title}`;
  const toggleButton = (
    <Button
      ref={toggleRef}
      size="xs"
      variant="ghost"
      aria-label={toggleLabel}
      aria-expanded={!collapsed}
      title={toggleLabel}
      onClick={toggle}
    >
      <ChevronIcon open={!collapsed} />
    </Button>
  );

  // The narrow strip: name, real card count and the Expand button. No WIP controls.
  if (collapsed) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <h2 id={`column-${id}`} className="flex min-w-0 items-center gap-2 px-1 text-sm font-semibold">
          <span className="break-words" title={title}>
            {title}
          </span>
          <span className={`rounded-full px-2 text-xs font-medium ${badgeTone}`}>
            {limit === undefined ? total : `${total} / ${limit}`}
          </span>
        </h2>
        {overdueBadge}
        {roleMarker}
        {toggleButton}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h2 id={`column-${id}`} className="flex items-center gap-2 px-1 text-sm font-semibold">
<span title={title}>{title}</span>
          <span className={`rounded-full px-2 text-xs font-medium ${badgeTone}`}>
            {limit === undefined ? total : `${total} / ${limit}`}
          </span>
        </h2>
        {overdueBadge}
        {roleMarker}
        {status.state === "at" && (
          <span className="text-xs font-medium text-amber-800 dark:text-amber-300">At limit</span>
        )}
        {status.state === "over" && (
          <span className="text-xs font-medium text-red-700 dark:text-red-300">Over limit by {status.over}</span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {toggleButton}
        {children}
      </div>
    </div>
  );
}
