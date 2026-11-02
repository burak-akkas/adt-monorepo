import { MAX_ACTIVITY_ENTRIES } from "./types";
import type { ActivityEntry, ActivityOptions, ActivityType, Card } from "./types";

// Returns a new card with the entry prepended (newest first) and the log capped.
export function withActivity(
  card: Card,
  entry: { type: ActivityType; from?: string; to?: string },
  { now = new Date(), id = crypto.randomUUID() }: ActivityOptions = {},
): Card {
  const full: ActivityEntry = { id, at: now.toISOString(), type: entry.type };
  if (entry.from !== undefined) {
    full.from = entry.from;
  }
  if (entry.to !== undefined) {
    full.to = entry.to;
  }
  return { ...card, activity: [full, ...(card.activity ?? [])].slice(0, MAX_ACTIVITY_ENTRIES) };
}
