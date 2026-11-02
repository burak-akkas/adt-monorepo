"use client";

import { createPreferenceStore } from "@/hooks/createPreferenceStore";
import { loadSummaryCollapsed, saveSummaryCollapsed, SUMMARY_COLLAPSED_KEY } from "@/lib/summaryCollapsed";

// Server snapshot is "expanded", so the static export hydrates without a mismatch.
const store = createPreferenceStore<boolean>({
  key: SUMMARY_COLLAPSED_KEY,
  load: loadSummaryCollapsed,
  save: saveSummaryCollapsed,
  serverValue: false,
});

export const useSummaryCollapsed = store.useValue;

// Tests only: forget the cached value so the next read comes from storage.
export const resetSummaryCollapsedStore = store.reset;
