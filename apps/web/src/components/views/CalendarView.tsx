"use client";

import { useId, useState, type DragEvent } from "react";
import { DueChip } from "@/components/card/DueChip";
import { cardDueStatus, findCard, isValidDueDate, setDueDate, todayString, type Board } from "@/lib/board";
import {
  calendarCards,
  formatLongDate,
  formatMonth,
  monthGrid,
  monthOf,
  shiftMonth,
  type CalendarCard,
} from "@/lib/calendar";
import { coverStyles } from "@/components/card/coverColors";
import { CARD_DRAG_TYPE } from "@/components/card/CardItem";
import { Button, Dialog, Input } from "@/components/ui";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// Month grid of the open cards of `board` (already narrowed by the board's search and filters) by due date.
// A card moves to another day by drag and drop or with the "Move to date" dialog; both use `setDueDate`.
export function CalendarView({
  board,
  onOpen,
  onUpdateBoard,
}: {
  board: Board;
  onOpen: (cardId: string) => void;
  onUpdateBoard: (fn: (board: Board) => Board) => void;
}) {
  const today = todayString();
  const [month, setMonth] = useState(() => monthOf(today));
  const [moving, setMoving] = useState<CalendarCard | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const headingId = useId();
  const { scheduled, unscheduled } = calendarCards(board);
  const grid = monthGrid(month.year, month.month);

  function schedule(cardId: string, date: string) {
    onUpdateBoard((b) => (findCard(b, cardId) && isValidDueDate(date) ? setDueDate(b, cardId, date) : b));
  }

  function isCardDrag(event: DragEvent) {
    return Array.from(event.dataTransfer.types).includes(CARD_DRAG_TYPE);
  }

  function handleDragOver(event: DragEvent, date: string) {
    if (!isCardDrag(event)) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDragOver(date);
  }

  function handleDrop(event: DragEvent, date: string) {
    const id = event.dataTransfer.getData(CARD_DRAG_TYPE);
    setDragOver(null);
    if (!id) {
      return;
    }
    event.preventDefault();
    schedule(id, date);
  }

  function renderCard({ card, listId }: CalendarCard) {
    const status = cardDueStatus(board, card, listId, today);
    return (
      <li
        key={card.id}
        draggable
        onDragStart={(event) => {
          event.dataTransfer.setData(CARD_DRAG_TYPE, card.id);
          event.dataTransfer.effectAllowed = "move";
        }}
        onDragEnd={() => setDragOver(null)}
        className="flex items-stretch gap-1 rounded-md border border-line bg-surface text-xs shadow-sm"
      >
        {card.cover && <span aria-hidden="true" className={`w-1.5 shrink-0 rounded-l-md ${coverStyles[card.cover]}`} />}
        <button
          type="button"
          onClick={() => onOpen(card.id)}
          className="min-w-0 flex-1 px-1.5 py-1 text-left hover:underline focus-visible:outline-2 focus-visible:outline-accent"
        >
          <span className="block truncate">{card.title}</span>{" "}
          {status && (
            <span className="block">
              <DueChip status={status} />
            </span>
          )}
        </button>
        <button
          type="button"
          aria-label={`Move ${card.title} to date`}
          title="Move to date"
          onClick={() => setMoving({ card, listId })}
          className="shrink-0 rounded-r-md px-1.5 text-subtle hover:bg-surface-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-accent"
        >
          <span aria-hidden="true">📅</span>
        </button>
      </li>
    );
  }

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" aria-label="Previous month" onClick={() => setMonth((m) => shiftMonth(m, -1))}>
            ←
          </Button>
          <Button size="sm" aria-label="Next month" onClick={() => setMonth((m) => shiftMonth(m, 1))}>
            →
          </Button>
          <Button size="sm" onClick={() => setMonth(monthOf(today))}>
            Today
          </Button>
          <h2 id={headingId} aria-live="polite" className="text-lg font-semibold">
            {formatMonth(month)}
          </h2>
        </div>
        <div className="relative max-w-full overflow-x-auto rounded-xl border border-field bg-surface">
          <table className="w-full min-w-[40rem] table-fixed border-collapse text-sm" aria-labelledby={headingId}>
            <thead className="bg-surface-muted">
              <tr>
                {WEEKDAYS.map((name) => (
                  <th key={name} scope="col" className="px-2 py-1 text-left font-medium">
                    <span aria-hidden="true">{name.slice(0, 3)}</span>
                    <span className="sr-only">{name}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.map((week) => (
                <tr key={week[0].date}>
                  {week.map(({ date, inMonth }) => {
                    const isToday = date === today;
                    const entries = scheduled.get(date) ?? [];
                    return (
                      <td
                        key={date}
                        aria-label={formatLongDate(date)}
                        aria-current={isToday ? "date" : undefined}
                        onDragEnter={(event) => handleDragOver(event, date)}
                        onDragOver={(event) => handleDragOver(event, date)}
                        onDragLeave={() => setDragOver((d) => (d === date ? null : d))}
                        onDrop={(event) => handleDrop(event, date)}
                        className={`h-28 border border-field p-1 align-top ${
                          dragOver === date
                            ? "bg-indigo-50 ring-2 ring-inset ring-indigo-500 dark:bg-indigo-950/40"
                            : inMonth
                              ? ""
                              : "bg-surface-muted text-muted"
                        }`}
                      >
                        <div
                          aria-hidden="true"
                          className={`mb-1 inline-flex size-6 items-center justify-center rounded-full text-xs ${
                            isToday ? "bg-accent font-semibold text-white" : ""
                          }`}
                        >
                          {Number(date.slice(8))}
                        </div>
                        {entries.length > 0 && <ul className="flex flex-col gap-1">{entries.map(renderCard)}</ul>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <section aria-labelledby={`${headingId}-unscheduled`} className="rounded-xl bg-surface-muted p-3 lg:w-64 lg:shrink-0">
        <h2 id={`${headingId}-unscheduled`} className="mb-2 text-sm font-semibold">
          Unscheduled
        </h2>
        {unscheduled.length === 0 ? (
          <p className="text-sm text-muted">No unscheduled cards</p>
        ) : (
          <ul className="flex flex-col gap-1">{unscheduled.map(renderCard)}</ul>
        )}
      </section>

      {moving && (
        <MoveToDateDialog
          card={moving.card}
          today={today}
          onMove={(date) => {
            schedule(moving.card.id, date);
            setMoving(null);
          }}
          onClose={() => setMoving(null)}
        />
      )}
    </div>
  );
}

function MoveToDateDialog({
  card,
  today,
  onMove,
  onClose,
}: {
  card: CalendarCard["card"];
  today: string;
  onMove: (date: string) => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const [date, setDate] = useState(card.dueDate ?? today);
  const valid = isValidDueDate(date);
  return (
    <Dialog labelledBy={titleId} onRequestClose={onClose}>
      <form
        className="flex flex-col gap-3 p-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) {
            onMove(date);
          }
        }}
      >
        <h2 id={titleId} className="text-base font-semibold">
          Move to date
        </h2>
        <p className="truncate text-sm text-subtle">{card.title}</p>
        <label className="flex flex-col gap-1 text-sm">
          New due date
          <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </label>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={!valid}>
            Move
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
