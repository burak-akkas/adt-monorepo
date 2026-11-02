// Pure board logic. Every function returns a new board and never mutates its input.

// A list id. Boards migrated from the fixed columns keep "todo", "doing" and "done".
export type ColumnId = string;

export type Priority = "low" | "medium" | "high";

export type CoverColor = "red" | "orange" | "yellow" | "green" | "teal" | "blue" | "purple" | "pink";

export interface Card {
  id: string;
  title: string;
  createdAt: string;
  priority: Priority;
  // Optional cover color from COVER_COLORS. Absent means no cover.
  cover?: CoverColor;
  // Optional date-only due date, `YYYY-MM-DD` (local calendar day).
  dueDate?: string;
  // Optional multi-line plain-text notes (trimmed, at most MAX_NOTES_LENGTH characters).
  notes?: string;
  // Optional labels (trimmed, unique case-insensitively, each at most MAX_LABEL_LENGTH characters).
  labels?: string[];
  // Optional checklist (each item's text trimmed, at most MAX_CHECKLIST_ITEM_LENGTH characters).
  checklist?: ChecklistItem[];
  // Optional comments, oldest first.
  comments?: CardComment[];
  // Optional change log, newest first, at most MAX_ACTIVITY_ENTRIES entries.
  activity?: ActivityEntry[];
}

export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

export interface CardComment {
  id: string;
  // Trimmed, at most MAX_COMMENT_LENGTH characters.
  text: string;
  createdAt: string;
  editedAt?: string;
}

export type ActivityType =
  | "created"
  | "moved"
  | "title"
  | "description"
  | "priority"
  | "dueDate"
  | "archived"
  | "restored"
  | "checklistDone"
  | "duplicated";

export interface ActivityEntry {
  id: string;
  // ISO timestamp.
  at: string;
  type: ActivityType;
  // Column ids for `moved`; old/new value for `title`, `priority` and `dueDate` (omitted when empty).
  // `checklistDone` keeps the item text in `to`. `duplicated` keeps the source card's title in `from`. `description` stores no text.
  from?: string;
  to?: string;
}

export interface List {
  id: ColumnId;
  name: string;
}

export interface InsightsLists {
  doing?: ColumnId;
  done?: ColumnId;
}

// A reusable card blueprint. Checklist items have no `done` flag, so templates are always unticked.
export interface CardTemplate {
  id: string;
  name: string;
  title: string;
  notes?: string;
  labels?: string[];
  priority: Priority;
  cover?: CoverColor;
  checklist?: { id: string; text: string }[];
}

export type BoardView = "board" | "calendar" | "table";

export const BOARD_VIEWS: readonly BoardView[] = ["board", "calendar", "table"];

export type BoardBackground = { type: "color"; value: string } | { type: "image"; url: string };

export const MAX_BACKGROUND_URL_LENGTH = 2048;

export interface Board {
  // Optional board background: a `#rrggbb` color or an http(s) image URL. Absent means the default look.
  background?: BoardBackground;
  // Which view is shown. Absent means the list view ("board").
  view?: BoardView;
  // Card templates of this board. Not part of `columns`, so search, insights, calendar and table never see them.
  templates?: CardTemplate[];
  // Ordered lists. Absent on boards built before custom lists: they have the default three (see `boardLists`).
  lists?: List[];
  // Cards per list id.
  columns: Record<ColumnId, Card[]>;
  // Cards removed with "Archive", oldest first.
  archive: Card[];
  // Optional soft WIP limits per list (whole numbers from 1 to MAX_WIP_LIMIT). Never blocks anything.
  wipLimits?: Partial<Record<ColumnId, number>>;
  // Ids of lists shown as a narrow strip. Purely visual; absent when no list is collapsed.
  collapsedLists?: ColumnId[];
  // Last name of deleted lists, so old activity entries stay readable.
  formerLists?: Record<ColumnId, string>;
  // Which lists insights treat as "in progress" and "done". Absent: the lists named Doing / Done.
  insightsLists?: InsightsLists;
}

export const DEFAULT_LISTS: readonly List[] = [
  { id: "todo", name: "To do" },
  { id: "doing", name: "Doing" },
  { id: "done", name: "Done" },
];

export const MAX_LIST_NAME_LENGTH = 30;

export const DELETED_LIST_NAME = "Deleted list";

export const PRIORITIES: readonly { id: Priority; label: string }[] = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
];

export const DEFAULT_PRIORITY: Priority = "medium";

export const COVER_COLORS: readonly { id: CoverColor; label: string }[] = [
  { id: "red", label: "Red" },
  { id: "orange", label: "Orange" },
  { id: "yellow", label: "Yellow" },
  { id: "green", label: "Green" },
  { id: "teal", label: "Teal" },
  { id: "blue", label: "Blue" },
  { id: "purple", label: "Purple" },
  { id: "pink", label: "Pink" },
];

export function isCoverColor(value: unknown): value is CoverColor {
  return COVER_COLORS.some((c) => c.id === value);
}

export const MAX_TITLE_LENGTH = 120;

export const MAX_NOTES_LENGTH = 1000;

export const MAX_COMMENT_LENGTH = 1000;

export const MAX_LABEL_LENGTH = 20;

export const MAX_CHECKLIST_ITEM_LENGTH = 200;

export const MAX_WIP_LIMIT = 99;

export const MAX_ACTIVITY_ENTRIES = 50;

export const ACTIVITY_TYPES: readonly ActivityType[] = [
  "created",
  "moved",
  "title",
  "description",
  "priority",
  "dueDate",
  "archived",
  "restored",
  "checklistDone",
  "duplicated",
];

export interface ActivityOptions {
  now?: Date;
  id?: string;
}

export type ListNameResult = { ok: true; name: string } | { ok: false; error: string };

export type WipLimitResult = { ok: true; limit: number | undefined } | { ok: false; error: string };

export type WipState = "none" | "ok" | "at" | "over";

export interface CardEdits {
  title: string;
  notes: string | undefined;
  priority: Priority;
  dueDate: string | undefined;
  column: ColumnId;
  labels?: string[];
  // Only applied when the key is present; `undefined` with the key present clears the cover.
  cover?: CoverColor | undefined;
}

export interface BoardStats {
  total: number;
  done: number;
  // Share of cards in Done, rounded to a whole percent (0 for an empty board).
  percentDone: number;
  overdue: number;
  // High priority cards that are not in Done.
  highOpen: number;
}
