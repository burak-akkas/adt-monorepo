"use client";

import type { BoardStats } from "@/lib/board";
import { Surface } from "@/components/ui";

export function SummaryBar({
  stats,
  overdueOnly,
  onToggleOverdue,
  dueTodayOnly,
  onToggleDueToday,
  assignedToMeCount,
  assignedToMeOnly,
  onToggleAssignedToMe,
  collapsed,
  onToggleCollapsed,
}: {
  stats: BoardStats;
  overdueOnly: boolean;
  onToggleOverdue: () => void;
  dueTodayOnly: boolean;
  onToggleDueToday: () => void;
  assignedToMeCount: number;
  assignedToMeOnly: boolean;
  onToggleAssignedToMe: () => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  if (stats.total === 0) {
    return (
      <Surface aria-label="Board summary" className="text-center text-sm text-muted">
        No cards yet. Add one to see your progress.
      </Surface>
    );
  }

  const toggle = (
    <button
      type="button"
      aria-expanded={!collapsed}
      aria-label={collapsed ? "Expand board summary" : "Collapse board summary"}
      onClick={onToggleCollapsed}
      className="rounded-md border border-line px-2 py-0.5 text-xs font-medium text-subtle hover:bg-surface-muted"
    >
      <span aria-hidden="true">{collapsed ? "▸" : "▾"}</span>
    </button>
  );

  if (collapsed) {
    return (
      <Surface aria-label="Board summary" className="flex items-center gap-3 text-sm">
        {toggle}
        <span className="text-xs text-subtle">{stats.percentDone}% done</span>
      </Surface>
    );
  }

  return (
    <Surface aria-label="Board summary" className="flex flex-col gap-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        {toggle}
        <p>
          <span className="font-semibold">{stats.total}</span> {stats.total === 1 ? "card" : "cards"} total
        </p>
        {stats.overdue > 0 ? (
          <button
            type="button"
            aria-pressed={overdueOnly}
            aria-label={`Overdue: ${stats.overdue}. ${overdueOnly ? "Show all cards" : "Show only overdue cards"}`}
            onClick={onToggleOverdue}
            className={`rounded-md border px-2 py-0.5 font-medium ${
              overdueOnly
                ? "border-red-600 bg-red-600 text-white dark:border-red-500 dark:bg-red-500 dark:text-zinc-950"
                : "border-red-300 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-800 dark:bg-red-950/50 dark:text-red-300 dark:hover:bg-red-950"
            }`}
          >
            <span aria-hidden="true">⚠ </span>
            Overdue: {stats.overdue}
          </button>
        ) : (
          <p>Overdue: 0</p>
        )}
        {stats.dueToday > 0 ? (
          <button
            type="button"
            aria-pressed={dueTodayOnly}
            aria-label={`Due today: ${stats.dueToday}. ${dueTodayOnly ? "Show all cards" : "Show only cards due today"}`}
            onClick={onToggleDueToday}
            className={`rounded-md border px-2 py-0.5 font-medium ${
              dueTodayOnly
                ? "border-amber-600 bg-amber-600 text-white dark:border-amber-500 dark:bg-amber-500 dark:text-zinc-950"
                : "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300 dark:hover:bg-amber-950"
            }`}
          >
            Due today: {stats.dueToday}
          </button>
        ) : (
          <p>Due today: 0</p>
        )}
        {assignedToMeCount > 0 && (
          <button
            type="button"
            aria-pressed={assignedToMeOnly}
            aria-label={`Assigned to me: ${assignedToMeCount}. ${assignedToMeOnly ? "Show all cards" : "Show only cards assigned to me"}`}
            onClick={onToggleAssignedToMe}
            className={`rounded-md border px-2 py-0.5 font-medium ${
              assignedToMeOnly
                ? "border-sky-600 bg-sky-600 text-white dark:border-sky-500 dark:bg-sky-500 dark:text-zinc-950"
                : "border-sky-300 bg-sky-50 text-sky-800 hover:bg-sky-100 dark:border-sky-800 dark:bg-sky-950/50 dark:text-sky-300 dark:hover:bg-sky-950"
            }`}
          >
            Assigned to me: {assignedToMeCount}
          </button>
        )}
        <p>High priority open: {stats.highOpen}</p>
      </div>
      <div className="flex items-center gap-3">
        <div
          role="progressbar"
          aria-label="Cards done"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={stats.percentDone}
          aria-valuetext={`${stats.percentDone}% done (${stats.done} of ${stats.total})`}
          className="h-2 flex-1 overflow-hidden rounded-full bg-line"
        >
          <div className="h-full bg-emerald-600 dark:bg-emerald-500" style={{ width: `${stats.percentDone}%` }} />
        </div>
        <span className="w-24 text-right text-xs text-subtle">{stats.percentDone}% done</span>
      </div>
    </Surface>
  );
}
