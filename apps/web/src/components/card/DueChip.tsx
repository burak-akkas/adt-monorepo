import type { DueStatus } from "@/lib/board";

const chips: Record<DueStatus, { label: string; icon: string; className: string }> = {
  overdue: {
    label: "Overdue",
    icon: "⚠ ",
    className: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300",
  },
  today: {
    label: "Due today",
    icon: "⏰ ",
    className: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200",
  },
  tomorrow: {
    label: "Due tomorrow",
    icon: "",
    className: "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  },
};

// Small status chip for a card's due date. The status is always spelled out, never colour alone.
export function DueChip({ status }: { status: DueStatus }) {
  const { label, icon, className } = chips[status];
  return (
    <span data-testid="due-chip" data-status={status} className={`rounded-full px-2 py-0.5 font-medium ${className}`}>
      {icon && <span aria-hidden="true">{icon}</span>}
      {label}
    </span>
  );
}
