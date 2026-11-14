import { assigneeInitials } from "@/lib/board";

const avatar =
  "flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ring-2 ring-white dark:ring-zinc-900 bg-zinc-200 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-100";

// Initials avatars for a card's assignees: the first `max`, then one "+n" item for the rest. Not interactive.
export function AssigneeAvatars({ assignees, max = 3 }: { assignees?: readonly string[]; max?: number }) {
  if (!assignees || assignees.length === 0) {
    return null;
  }
  const shown = assignees.slice(0, max);
  const rest = assignees.slice(max);
  return (
    <ul aria-label="Assignees" className="flex -space-x-1">
      {shown.map((email) => (
        <li key={email} aria-label={`Assigned to ${email}`} title={email} className={avatar}>
          <span aria-hidden="true">{assigneeInitials(email)}</span>
        </li>
      ))}
      {rest.length > 0 && (
        <li aria-label={`${rest.length} more assigned: ${rest.join(", ")}`} title={rest.join(", ")} className={avatar}>
          <span aria-hidden="true">+{rest.length}</span>
        </li>
      )}
    </ul>
  );
}
