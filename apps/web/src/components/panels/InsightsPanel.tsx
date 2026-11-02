"use client";

import { useId } from "react";
import type { ReactNode } from "react";
import { formatDueDate, insightsListIds, listName } from "@/lib/board";
import type { Board } from "@/lib/board";
import { barRects, chartBounds, chartMax, linePoints } from "@/lib/chart";
import type { ChartSize } from "@/lib/chart";
import {
  cycleTimes,
  dailyWip,
  formatDuration,
  overdueCards,
  summarizeCycleTimes,
  weeklyThroughput,
} from "@/lib/insights";
import { Button, Dialog } from "@/components/ui";

// Names of the lists insights use; a placeholder when none is chosen.
function insightsNames(board: Board): { doing: string; done: string } {
  const { doing, done } = insightsListIds(board);
  return {
    doing: doing === undefined ? "the in-progress list" : listName(board, doing),
    done: done === undefined ? "the done list" : listName(board, done),
  };
}

function CycleTimeSection({ board, now }: { board: Board; now?: Date }) {
  const headingId = useId();
  const { doing, done } = insightsNames(board);
  const { durationsMs, excluded } = cycleTimes(board, { now });
  const summary = summarizeCycleTimes(durationsMs);
  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-2">
      <h3 id={headingId} className="text-sm font-semibold">
        Cycle time
      </h3>
      {summary ? (
        <dl className="flex gap-6 text-sm">
          <div>
            <dt className="text-xs text-muted">Median</dt>
            <dd className="font-medium">{formatDuration(summary.median)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Average</dt>
            <dd className="font-medium">{formatDuration(summary.average)}</dd>
          </div>
        </dl>
      ) : (
        <p className="text-sm text-muted">No finished cards with a recorded {doing} → {done} history yet</p>
      )}
      {excluded > 0 && (
        <p className="text-xs text-muted">
          {excluded} {excluded === 1 ? "card" : "cards"} left out (no recorded {doing} → {done} history)
        </p>
      )}
    </section>
  );
}

const CHART_SIZE: ChartSize = { width: 320, height: 140, padding: { top: 18, right: 12, bottom: 24, left: 28 } };

function ChartFrame({ max, children }: { max: number; children: ReactNode }) {
  const { top, bottom } = chartBounds(CHART_SIZE);
  const { left, right } = CHART_SIZE.padding;
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox={`0 0 ${CHART_SIZE.width} ${CHART_SIZE.height}`}
      className="h-auto w-full max-w-full"
    >
      <line x1={left} x2={CHART_SIZE.width - right} y1={top} y2={top} className="stroke-line" strokeDasharray="3 3" />
      <line x1={left} x2={CHART_SIZE.width - right} y1={bottom} y2={bottom} className="stroke-line" />
      <text x={left - 4} y={top + 3} textAnchor="end" fontSize="9" className="fill-muted">
        {max}
      </text>
      <text x={left - 4} y={bottom + 3} textAnchor="end" fontSize="9" className="fill-muted">
        0
      </text>
      {children}
    </svg>
  );
}

function DataTable({
  caption,
  rowHeader,
  valueHeader,
  rows,
}: {
  caption: string;
  rowHeader: string;
  valueHeader: string;
  rows: { label: string; count: number }[];
}) {
  return (
    <table className="w-full text-xs tabular-nums">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr className="text-left text-muted">
          <th scope="col" className="py-0.5 pr-2 font-medium">
            {rowHeader}
          </th>
          <th scope="col" className="py-0.5 text-right font-medium">
            {valueHeader}
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label} className="border-t border-line dark:border-field">
            <th scope="row" className="py-0.5 pr-2 text-left font-normal">
              {row.label}
            </th>
            <td className="py-0.5 text-right">{row.count}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ThroughputSection({ board, now }: { board: Board; now?: Date }) {
  const headingId = useId();
  const { done } = insightsNames(board);
  const weeks = weeklyThroughput(board, { now });
  const counts = weeks.map((w) => w.count);
  const bars = barRects(counts, CHART_SIZE);
  const baseline = chartBounds(CHART_SIZE).bottom;
  const empty = counts.every((c) => c === 0);
  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-2">
      <h3 id={headingId} className="text-sm font-semibold">
        Throughput
      </h3>
      <ChartFrame max={chartMax(counts)}>
        {bars.map((bar, i) => (
          <g key={weeks[i].weekStart}>
            {counts[i] > 0 && (
              <>
                <rect x={bar.x} y={bar.y} width={bar.width} height={bar.height} rx={2} className="fill-accent" />
                <text x={bar.x + bar.width / 2} y={bar.y - 3} textAnchor="middle" fontSize="9" className="fill-foreground">
                  {counts[i]}
                </text>
              </>
            )}
            <text x={bar.x + bar.width / 2} y={baseline + 14} textAnchor="middle" fontSize="8" className="fill-muted">
              {weeks[i].label}
            </text>
          </g>
        ))}
      </ChartFrame>
      {empty && <p className="text-sm text-muted">No cards moved to {done} in the last {weeks.length} weeks</p>}
      <DataTable
        caption={`Cards moved to ${done} per week`}
        rowHeader="Week of"
        valueHeader={`Cards moved to ${done}`}
        rows={weeks.map((w) => ({ label: w.label, count: w.count }))}
      />
    </section>
  );
}

function WipSection({ board, now }: { board: Board; now?: Date }) {
  const headingId = useId();
  const { doing } = insightsNames(board);
  const days = dailyWip(board, { now });
  const counts = days.map((d) => d.count);
  const points = linePoints(counts, CHART_SIZE);
  const baseline = chartBounds(CHART_SIZE).bottom;
  const empty = counts.every((c) => c === 0);
  const labelled = new Set([0, Math.floor((days.length - 1) / 2), days.length - 1]);
  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-2">
      <h3 id={headingId} className="text-sm font-semibold">
        WIP over time
      </h3>
      <ChartFrame max={chartMax(counts)}>
        <polyline
          points={points.map((p) => `${p.x},${p.y}`).join(" ")}
          fill="none"
          strokeWidth={2}
          strokeLinejoin="round"
          className="stroke-accent"
        />
        {points.map((p, i) => (
          <g key={days[i].day}>
            <circle cx={p.x} cy={p.y} r={2.5} className="fill-accent" />
            {labelled.has(i) && (
              <text x={p.x} y={baseline + 14} textAnchor={i === 0 ? "start" : i === days.length - 1 ? "end" : "middle"} fontSize="8" className="fill-muted">
                {formatDueDate(days[i].day)}
              </text>
            )}
          </g>
        ))}
      </ChartFrame>
      {empty && <p className="text-sm text-muted">No cards in {doing} in the last {days.length} days</p>}
      <DataTable
        caption={`Cards in ${doing} per day`}
        rowHeader="Day"
        valueHeader={`Cards in ${doing}`}
        rows={days.map((d) => ({ label: formatDueDate(d.day), count: d.count }))}
      />
    </section>
  );
}

function OverdueSection({ board, now, onOpenCard }: { board: Board; now?: Date; onOpenCard: (cardId: string) => void }) {
  const headingId = useId();
  const overdue = overdueCards(board, { now });
  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-2">
      <h3 id={headingId} className="text-sm font-semibold">
        Overdue
      </h3>
      {overdue.length === 0 ? (
        <p className="text-sm text-muted">No overdue cards</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {overdue.map((card) => {
            const due = formatDueDate(card.dueDate ?? "");
            return (
              <li key={card.id}>
                <button
                  type="button"
                  aria-label={`Open "${card.title}" (due ${due})`}
                  onClick={() => onOpenCard(card.id)}
                  className="flex w-full min-w-0 items-center justify-between gap-3 rounded-md border border-line px-3 py-2 text-left text-sm outline-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent dark:border-field"
                >
                  <span className="min-w-0 break-words">{card.title}</span>
                  <span className="shrink-0 text-xs text-danger">{due}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function InsightsPanel({
  board,
  now,
  onClose,
  onOpenCard,
}: {
  board: Board;
  now?: Date;
  onClose: () => void;
  onOpenCard: (cardId: string) => void;
}) {
  const headingId = useId();
  const { doing, done } = insightsListIds(board);
  return (
    <Dialog labelledBy={headingId} onRequestClose={onClose}>
      <div className="flex max-w-full min-w-0 flex-col gap-5 p-5">
        <h2 id={headingId} className="text-lg font-semibold">
          Board insights
        </h2>
        {doing === undefined && done === undefined && (
          <p className="text-sm text-muted">Choose the in-progress and done lists in Settings.</p>
        )}
        <CycleTimeSection board={board} now={now} />
        <ThroughputSection board={board} now={now} />
        <WipSection board={board} now={now} />
        <OverdueSection board={board} now={now} onOpenCard={onOpenCard} />
        <div className="flex">
          <Button variant="primary" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
