import { DEFAULT_LISTS, formatDueDate, listName, PRIORITIES, type ActivityEntry, type Board } from "@/lib/board";
import { formatRelativeTime } from "@/lib/time";

const priorityName = (id: string | undefined) => PRIORITIES.find((p) => p.id === id)?.label ?? id ?? "";

// Without a board the default list names are used and unknown ids are shown as they are.
function nameResolver(board: Board | undefined): (id: string | undefined) => string {
  if (board) {
    return (id) => listName(board, id);
  }
  return (id) => DEFAULT_LISTS.find((l) => l.id === id)?.name ?? id ?? "";
}

export function describeActivity(entry: ActivityEntry, board?: Board): string {
  const columnName = nameResolver(board);
  switch (entry.type) {
    case "created":
      return "Created";
    case "moved":
      return `Moved from ${columnName(entry.from)} to ${columnName(entry.to)}`;
    case "title":
      return `Title changed from “${entry.from ?? ""}” to “${entry.to ?? ""}”`;
    case "description":
      return "Description changed";
    case "priority":
      return `Priority changed from ${priorityName(entry.from)} to ${priorityName(entry.to)}`;
    case "dueDate":
      return entry.to ? `Due date set to ${formatDueDate(entry.to)}` : "Due date cleared";
    case "archived":
      return "Archived";
    case "restored":
      return "Restored";
    case "checklistDone":
      return `Completed checklist item “${entry.to ?? ""}”`;
    case "duplicated":
      return `created as a copy of ${entry.from ?? ""}`;
  }
}

// Read-only, newest first (the order they are stored in).
export function ActivityLog({ activity, now, board }: { activity: ActivityEntry[] | undefined; now?: Date; board?: Board }) {
  if (!activity || activity.length === 0) {
    return <p className="text-xs text-muted">No activity yet</p>;
  }
  return (
    <ol aria-label="Activity" className="flex max-h-48 flex-col gap-1 overflow-y-auto text-xs">
      {activity.map((entry) => (
        <li key={entry.id} className="flex flex-wrap items-baseline justify-between gap-x-3">
          <span className="break-words">{describeActivity(entry, board)}</span>
          <time
            dateTime={entry.at}
            title={new Date(entry.at).toLocaleString()}
            tabIndex={0}
            className="text-muted"
          >
            {formatRelativeTime(entry.at, now)}
          </time>
        </li>
      ))}
    </ol>
  );
}
