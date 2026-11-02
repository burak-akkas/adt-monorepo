import { defaultStorage, readPreference, writePreference } from "@/lib/preference";

export const SUMMARY_COLLAPSED_KEY = "kanban:summary-collapsed";

// Stored as "1" (collapsed) or "0"; anything else reads as expanded.
export function loadSummaryCollapsed(storage = defaultStorage()): boolean {
  return readPreference(SUMMARY_COLLAPSED_KEY, (raw) => raw === "1", false, storage);
}

export function saveSummaryCollapsed(value: boolean, storage = defaultStorage()): void {
  writePreference(SUMMARY_COLLAPSED_KEY, value ? "1" : "0", storage);
}
