"use client";

import { Button, Select } from "@/components/ui";
import { LabelChip } from "./LabelChip";

export function LabelFilter({
  labels,
  value,
  onChange,
}: {
  labels: string[];
  value: string | null;
  onChange: (label: string | null) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Select
        aria-label="Filter by label"
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value || null)}
      >
        <option value="">All labels</option>
        {labels.map((label) => (
          <option key={label} value={label}>
            {label}
          </option>
        ))}
      </Select>
      {value !== null && (
        <>
          <LabelChip label={value} />
          <Button variant="ghost" size="xs" onClick={() => onChange(null)}>
            Clear label filter
          </Button>
        </>
      )}
    </div>
  );
}
