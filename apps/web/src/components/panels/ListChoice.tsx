"use client";

import { useId } from "react";
import { boardLists, insightsListIds, setInsightsList } from "@/lib/board";
import type { Board } from "@/lib/board";
import { Select } from "@/components/ui";

// The in-progress and done list choice, shared by the Settings and Insights dialogs.
export function ListChoice({
  board,
  onUpdateBoard,
}: {
  board: Board;
  onUpdateBoard: (change: (board: Board) => Board) => void;
}) {
  const headingId = useId();
  const ids = insightsListIds(board);
  const field = (kind: "doing" | "done", label: string) => (
    <label className="flex flex-col gap-1 text-xs font-medium text-subtle">
      {label}
      <Select
        fieldSize="sm"
        value={ids[kind] ?? ""}
        onChange={(event) => {
          const id = event.target.value || undefined;
          onUpdateBoard((b) => (id === undefined || boardLists(b).some((l) => l.id === id) ? setInsightsList(b, kind, id) : b));
        }}
      >
        <option value="">Not set</option>
        {boardLists(board).map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </Select>
    </label>
  );
  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-2">
      <h3 id={headingId} className="text-sm font-semibold">
        Lists used
      </h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {field("doing", "In progress list")}
        {field("done", "Done list")}
      </div>
      <p className="text-xs text-muted">The done list is used for insights, archiving and overdue.</p>
      {(ids.doing === undefined || ids.done === undefined) && (
        <p className="text-xs text-muted">Pick the lists that mean in progress and done to see these numbers.</p>
      )}
    </section>
  );
}
