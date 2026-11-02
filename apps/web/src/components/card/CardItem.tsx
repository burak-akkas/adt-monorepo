"use client";

import { useId, type DragEvent } from "react";
import {
  checklistProgress,
  COVER_COLORS,
  formatDueDate,
  PRIORITIES,
  type Card,
  type CoverColor,
  type DueStatus,
  type Priority,
} from "@/lib/board";
import { coverStyles } from "./coverColors";
import { DueChip } from "./DueChip";
import { LabelChip } from "./LabelChip";

export const CARD_DRAG_TYPE = "application/x-kanban-card";

const priorityLabel = (id: Priority) => PRIORITIES.find((p) => p.id === id)?.label ?? id;

const coverLabel = (id: CoverColor) => COVER_COLORS.find((c) => c.id === id)?.label ?? id;

const badgeStyles: Record<Priority, string> = {
  low: "bg-zinc-200 font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  medium: "bg-amber-100 font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  high: "bg-red-600 font-bold text-white dark:bg-red-500 dark:text-white",
};

const cardSurface = "group rounded-lg border border-line bg-surface p-3 shadow-sm";

export function CardItem({
  card,
  dueStatus,
  onOpen,
  onFilterLabel,
  onDragStart,
  onDragEnd,
}: {
  card: Card;
  dueStatus: DueStatus | null;
  onOpen: () => void;
  onFilterLabel?: (label: string) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}) {
  const progress = checklistProgress(card);
  const commentCount = card.comments?.length ?? 0;
  const coverId = useId();

  function handleDragStart(event: DragEvent<HTMLLIElement>) {
    event.dataTransfer.setData(CARD_DRAG_TYPE, card.id);
    event.dataTransfer.effectAllowed = "move";
    onDragStart?.();
  }

  return (
    <li
      data-card-id={card.id}
      draggable
      onDragStart={handleDragStart}
      onDragEnd={onDragEnd}
      aria-describedby={card.cover ? coverId : undefined}
      className={`${cardSurface} cursor-grab active:cursor-grabbing${card.cover ? " relative overflow-hidden" : ""}`}
    >
      {card.cover && (
        <>
          <span
            aria-hidden="true"
            data-testid="cover-stripe"
            data-cover={card.cover}
            className={`absolute inset-x-0 top-0 h-1.5 ${coverStyles[card.cover]}`}
          />
          <span id={coverId} className="sr-only">
            Cover color: {coverLabel(card.cover)}
          </span>
        </>
      )}
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          aria-haspopup="dialog"
          onClick={onOpen}
          className="card-title min-w-0 break-words rounded text-left text-sm hover:underline"
        >
          {card.title}
        </button>
        <span
          data-testid="priority-badge"
          className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${badgeStyles[card.priority]}`}
        >
          {priorityLabel(card.priority)}
        </span>
      </div>
      {card.labels && card.labels.length > 0 && (
        <ul aria-label="Labels" className="mt-2 flex flex-wrap gap-1">
          {card.labels.map((label) => (
            <li key={label.toLowerCase()} className="max-w-full">
              <LabelChip label={label} onClick={() => onFilterLabel?.(label)} />
            </li>
          ))}
        </ul>
      )}
      {progress && (
        <p className="mt-2">
          <span
            role="img"
            aria-label={`${progress.done} of ${progress.total} checklist items done`}
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              progress.done === progress.total
                ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                : "bg-zinc-100 text-muted dark:bg-zinc-800"
            }`}
          >
            <span aria-hidden="true">
              ☑ {progress.done}/{progress.total}
            </span>
          </span>
        </p>
      )}
      {commentCount > 0 && (
        <div className="mt-2 flex items-center gap-1 text-xs">
          <span
            aria-label={`${commentCount} ${commentCount === 1 ? "comment" : "comments"}`}
            className="rounded-full bg-zinc-100 px-2 py-0.5 font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
          >
            <span aria-hidden="true">💬 {commentCount}</span>
          </span>
        </div>
      )}
      {(card.dueDate || card.notes) && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
          {card.dueDate && (
            <>
              <time dateTime={card.dueDate}>{formatDueDate(card.dueDate)}</time>
              {dueStatus && <DueChip status={dueStatus} />}
            </>
          )}
          {card.notes && (
            <span className="rounded-full bg-sky-50 px-2 py-0.5 font-medium text-sky-700 dark:bg-sky-950/40 dark:text-sky-300">
              <span aria-hidden="true">📝 </span>Has notes
            </span>
          )}
        </div>
      )}
    </li>
  );
}
