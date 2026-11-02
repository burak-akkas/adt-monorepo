"use client";

import type { BoardView } from "@/lib/board";

// Views offered in the switch.
const OPTIONS: readonly { id: BoardView; label: string }[] = [
  { id: "board", label: "Board" },
  { id: "calendar", label: "Calendar" },
  { id: "table", label: "Table" },
];

// Single-select segmented control built from native radio inputs, so arrow keys and Tab work as usual.
export function ViewSwitch({ value, onChange }: { value: BoardView; onChange: (view: BoardView) => void }) {
  return (
    <div role="radiogroup" aria-label="View" className="inline-flex overflow-hidden rounded-lg border border-field bg-surface text-sm">
      {OPTIONS.map(({ id, label }) => (
        <label
          key={id}
          className={`cursor-pointer px-3 py-2 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-inset has-[:focus-visible]:ring-accent ${
            value === id ? "bg-accent text-white" : "hover:bg-surface-muted"
          }`}
        >
          <input
            type="radio"
            name="board-view"
            value={id}
            checked={value === id}
            onChange={() => onChange(id)}
            className="sr-only"
          />
          {label}
        </label>
      ))}
    </div>
  );
}
