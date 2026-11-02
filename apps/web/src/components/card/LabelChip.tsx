import { labelColor } from "@/lib/board";

const chipStyles = "inline-block max-w-full truncate rounded-full px-2 py-0.5 text-xs font-medium";

// A small colored label. With `onClick` it is a button that filters the board by this label.
export function LabelChip({ label, onClick }: { label: string; onClick?: () => void }) {
  const className = `${chipStyles} ${labelColor(label)}`;
  if (!onClick) {
    return <span className={className}>{label}</span>;
  }
  return (
    <button
      type="button"
      aria-label={`Filter by label "${label}"`}
      onClick={onClick}
      className={`${className} hover:underline`}
    >
      {label}
    </button>
  );
}
