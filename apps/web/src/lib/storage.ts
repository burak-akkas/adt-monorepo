import { DEFAULT_BOARD_NAME, initialBoardList, type BoardEntry, type BoardList } from "./boards";
import {
  ACTIVITY_TYPES,
  addLabelToList,
  DEFAULT_LISTS,
  DEFAULT_PRIORITY,
  isCoverColor,
  isValidBackground,
  isValidDueDate,
  isValidWipLimit,
  MAX_ACTIVITY_ENTRIES,
  MAX_COMMENT_LENGTH,
  MAX_LIST_NAME_LENGTH,
  MAX_NOTES_LENGTH,
  MAX_TITLE_LENGTH,
  normalizeChecklistText,
  PRIORITIES,
  todayString,
  type ActivityEntry,
  type ActivityType,
  type Board,
  type Card,
  type CardComment,
  type CardTemplate,
  type ChecklistItem,
  type ColumnId,
  type InsightsLists,
  type List,
} from "./board";
import { MAX_TEMPLATES, validateTemplateName } from "./templates";

export const STORAGE_KEY = "kanban-boards-v2";
// Only read, to migrate old data; never written or removed.
export const LEGACY_STORAGE_KEY = "kanban-board-v1";

// Cards saved before priorities existed (or with an invalid value) are treated as the default priority.
function isCard(value: unknown): value is Omit<Card, "priority"> & { priority?: unknown } {
  const c = value as Card;
  return (
    typeof c === "object" &&
    c !== null &&
    typeof c.id === "string" &&
    typeof c.title === "string" &&
    typeof c.createdAt === "string" &&
    (c.dueDate === undefined || (typeof c.dueDate === "string" && isValidDueDate(c.dueDate)))
  );
}

// The stored `lists` when well-formed (non-empty, string ids and names, unique ids, names trimmed and capped);
// otherwise `undefined`, so the board is read in the old format with the default three lists.
function readLists(value: unknown): List[] | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }
  const ids = new Set<string>();
  const lists: List[] = [];
  for (const entry of value) {
    const l = entry as Partial<List> | null;
    if (typeof l !== "object" || l === null || typeof l.id !== "string" || !l.id || typeof l.name !== "string" || ids.has(l.id)) {
      return undefined;
    }
    const name = l.name.trim().slice(0, MAX_LIST_NAME_LENGTH).trim();
    if (!name) {
      return undefined;
    }
    ids.add(l.id);
    lists.push({ id: l.id, name });
  }
  return lists;
}

export function isBoard(value: unknown): value is Board {
  const board = value as Board | null;
  const columns = board?.columns;
  if (typeof columns !== "object" || columns === null) {
    return false;
  }
  const lists = readLists(board?.lists) ?? DEFAULT_LISTS;
  return lists.every(({ id }) => Array.isArray(columns[id]) && columns[id].every(isCard));
}

// Invalid priorities become the default; invalid or blank notes are dropped (never truncated).
function normalizeCard(card: Card): Card {
  const { notes, cover, labels, checklist, comments, activity, ...rest } = card as Card & {
    notes?: unknown;
    cover?: unknown;
    labels?: unknown;
    checklist?: unknown;
    comments?: unknown;
    activity?: unknown;
  };
  const priority = PRIORITIES.some((p) => p.id === card.priority) ? card.priority : DEFAULT_PRIORITY;
  const trimmed = typeof notes === "string" ? notes.trim() : "";
  const normalized: Card = { ...rest, priority };
  if (trimmed && trimmed.length <= MAX_NOTES_LENGTH) {
    normalized.notes = trimmed;
  }
  if (isCoverColor(cover)) {
    normalized.cover = cover;
  }
  const cleanLabels = normalizeLabels(labels);
  if (cleanLabels.length > 0) {
    normalized.labels = cleanLabels;
  }
  const cleanChecklist = normalizeChecklist(checklist);
  if (cleanChecklist.length > 0) {
    normalized.checklist = cleanChecklist;
  }
  const cleanComments = normalizeComments(comments);
  if (cleanComments.length > 0) {
    normalized.comments = cleanComments;
  }
  const cleanActivity = normalizeActivity(activity);
  if (cleanActivity.length > 0) {
    normalized.activity = cleanActivity;
  }
  return normalized;
}

// Keeps valid items only: malformed, blank, over-long and duplicate-id entries are dropped; text is trimmed.
function normalizeChecklist(value: unknown): ChecklistItem[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const ids = new Set<string>();
  const result: ChecklistItem[] = [];
  for (const entry of value) {
    const item = entry as Partial<ChecklistItem> | null;
    if (typeof item !== "object" || item === null || typeof item.id !== "string" || typeof item.text !== "string" || typeof item.done !== "boolean" || ids.has(item.id)) {
      continue;
    }
    try {
      result.push({ id: item.id, text: normalizeChecklistText(item.text), done: item.done });
      ids.add(item.id);
    } catch {
      // blank or too long: skip it
    }
  }
  return result;
}

const isValidDate = (value: unknown): value is string => typeof value === "string" && !Number.isNaN(new Date(value).getTime());

// Keeps valid comments only (stored trimmed, in stored order). Entries with a bad shape, blank or over-long text,
// an invalid `createdAt` or a duplicate id are dropped; an invalid `editedAt` is dropped on its own.
function normalizeComments(value: unknown): CardComment[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const result: CardComment[] = [];
  for (const entry of value) {
    const c = entry as Partial<Record<keyof CardComment, unknown>> | null;
    if (typeof c !== "object" || c === null || typeof c.id !== "string" || seen.has(c.id)) {
      continue;
    }
    const text = typeof c.text === "string" ? c.text.trim() : "";
    if (!text || text.length > MAX_COMMENT_LENGTH || !isValidDate(c.createdAt)) {
      continue;
    }
    seen.add(c.id);
    const comment: CardComment = { id: c.id, text, createdAt: c.createdAt };
    if (isValidDate(c.editedAt)) {
      comment.editedAt = c.editedAt;
    }
    result.push(comment);
  }
  return result;
}

// Keeps well-formed entries only (known type, valid date, string id, unique ids), in order, capped.
function normalizeActivity(value: unknown): ActivityEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const result: ActivityEntry[] = [];
  for (const entry of value) {
    const e = entry as Record<string, unknown> | null;
    if (
      typeof e !== "object" ||
      e === null ||
      typeof e.id !== "string" ||
      seen.has(e.id) ||
      typeof e.at !== "string" ||
      Number.isNaN(new Date(e.at).getTime()) ||
      !ACTIVITY_TYPES.some((t) => t === e.type) ||
      (e.from !== undefined && typeof e.from !== "string") ||
      (e.to !== undefined && typeof e.to !== "string")
    ) {
      continue;
    }
    seen.add(e.id);
    const clean: ActivityEntry = { id: e.id, at: e.at, type: e.type as ActivityType };
    if (e.from !== undefined) {
      clean.from = e.from as string;
    }
    if (e.to !== undefined) {
      clean.to = e.to as string;
    }
    result.push(clean);
  }
  return result.slice(0, MAX_ACTIVITY_ENTRIES);
}

// Keeps valid labels only: non-strings, blank, over-long and duplicate (case-insensitive) entries are dropped.
function normalizeLabels(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  let result: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") {
      continue;
    }
    try {
      result = addLabelToList(result, entry);
    } catch {
      // invalid or duplicate: skip it
    }
  }
  return result;
}

// Keeps valid templates only: malformed entries, duplicate ids, bad or duplicate names and bad titles are dropped.
// Notes, labels, priority, cover and checklist text go through the card normalizers (checklist items lose `done`).
function normalizeTemplates(value: unknown): CardTemplate[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const ids = new Set<string>();
  const result: CardTemplate[] = [];
  for (const entry of value) {
    const t = entry as Record<string, unknown> | null;
    if (typeof t !== "object" || t === null || typeof t.id !== "string" || ids.has(t.id) || typeof t.title !== "string") {
      continue;
    }
    const name = validateTemplateName(typeof t.name === "string" ? t.name : "", result);
    const title = t.title.trim();
    if (!name.ok || !title || title.length > MAX_TITLE_LENGTH || result.length >= MAX_TEMPLATES) {
      continue;
    }
    const card = normalizeCard({
      id: t.id,
      title,
      createdAt: "",
      priority: t.priority as Card["priority"],
      notes: t.notes as string,
      cover: t.cover as Card["cover"],
      labels: t.labels as string[],
      checklist: normalizeChecklist(
        Array.isArray(t.checklist) ? t.checklist.map((i: Record<string, unknown> | null) => ({ ...i, done: false })) : [],
      ),
    });
    ids.add(t.id);
    const template: CardTemplate = { id: t.id, name: name.name, title, priority: card.priority };
    if (card.notes !== undefined) {
      template.notes = card.notes;
    }
    if (card.labels) {
      template.labels = card.labels;
    }
    if (card.cover !== undefined) {
      template.cover = card.cover;
    }
    if (card.checklist) {
      template.checklist = card.checklist.map(({ id, text }) => ({ id, text }));
    }
    result.push(template);
  }
  return result;
}

// Boards saved before archiving have no `archive`; a corrupt one is dropped and invalid cards are skipped.
function normalizeBoard(board: Board): Board {
  const archive: unknown = (board as { archive?: unknown }).archive;
  // Invalid WIP limits are dropped; the key is only present when at least one limit is valid.
  const limits: unknown = (board as { wipLimits?: unknown }).wipLimits;
  // Old boards (no valid `lists`) become the default three lists with the same ids, so nothing else is rewritten.
  const lists = readLists(board.lists) ?? DEFAULT_LISTS.map((l) => ({ ...l }));
  const wipLimits: Partial<Record<ColumnId, number>> = {};
  if (typeof limits === "object" && limits !== null) {
    for (const { id } of lists) {
      const limit = (limits as Record<string, unknown>)[id];
      if (isValidWipLimit(limit)) {
        wipLimits[id] = limit;
      }
    }
  }
  const columns: Record<ColumnId, Card[]> = {};
  for (const { id } of lists) {
    columns[id] = board.columns[id].map(normalizeCard);
  }
  const has = (id: unknown): id is string => typeof id === "string" && lists.some((l) => l.id === id);
  // Names of deleted lists (ids no longer in `lists`).
  const former: unknown = (board as { formerLists?: unknown }).formerLists;
  const formerLists: Record<ColumnId, string> = {};
  if (typeof former === "object" && former !== null) {
    for (const [id, name] of Object.entries(former)) {
      if (typeof name === "string" && name.trim() && !has(id)) {
        formerLists[id] = name.trim().slice(0, MAX_LIST_NAME_LENGTH);
      }
    }
  }
  // Collapsed lists: unique ids of existing lists only.
  const storedCollapsed: unknown = (board as { collapsedLists?: unknown }).collapsedLists;
  const collapsedLists = Array.isArray(storedCollapsed)
    ? lists.map((l) => l.id).filter((id) => storedCollapsed.includes(id))
    : [];
  // A stored choice keeps its valid ids; without one the lists named Doing / Done are chosen.
  const chosen: unknown = (board as { insightsLists?: unknown }).insightsLists;
  const insightsLists: InsightsLists = {};
  if (typeof chosen === "object" && chosen !== null) {
    const { doing, done } = chosen as Record<string, unknown>;
    if (has(doing)) {
      insightsLists.doing = doing;
    }
    if (has(done)) {
      insightsLists.done = done;
    }
  } else {
    const named = (name: string) => lists.find((l) => l.name.toLowerCase() === name)?.id;
    const doing = named("doing");
    const done = named("done");
    if (doing !== undefined) {
      insightsLists.doing = doing;
    }
    if (done !== undefined) {
      insightsLists.done = done;
    }
  }
  const templates = normalizeTemplates((board as { templates?: unknown }).templates);
  const view: unknown = (board as { view?: unknown }).view;
  const background: unknown = (board as { background?: unknown }).background;
  return {
    ...(isValidBackground(background) && {
      background: background.type === "color" ? { type: "color" as const, value: background.value } : { type: "image" as const, url: background.url },
    }),
    ...((view === "table" || view === "calendar") && { view }),
    lists,
    ...(templates.length > 0 && { templates }),
    ...(Object.keys(wipLimits).length > 0 && { wipLimits }),
    ...(collapsedLists.length > 0 && { collapsedLists }),
    ...(Object.keys(formerLists).length > 0 && { formerLists }),
    insightsLists,
    columns,
    archive: Array.isArray(archive) ? (archive.filter(isCard) as Card[]).map(normalizeCard) : [],
  };
}

export function serializeBoard(board: Board): string {
  return JSON.stringify(board, null, 2);
}

export type ParseResult = { ok: true; board: Board } | { ok: false; error: string };

// Validates exported/imported text with the same rules as localStorage data.
export function parseBoard(text: string): ParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "This file is not valid JSON." };
  }
  if (!isBoard(parsed)) {
    return { ok: false, error: "This file is not a Kanban board export." };
  }
  return { ok: true, board: normalizeBoard(parsed) };
}

export function exportFilename(now: Date = new Date()): string {
  return `kanban-board-${todayString(now)}.json`;
}

function isBoardEntry(value: unknown): value is BoardEntry {
  const e = value as BoardEntry | null;
  return typeof e === "object" && e !== null && typeof e.id === "string" && typeof e.name === "string" && isBoard(e.board);
}

export function isBoardList(value: unknown): value is BoardList {
  const list = value as BoardList | null;
  return typeof list === "object" && list !== null && typeof list.currentId === "string" && Array.isArray(list.boards);
}

// Invalid and duplicate-id entries are dropped; an unknown currentId falls back to the first board.
function normalizeBoardList(list: BoardList): BoardList | null {
  const seen = new Set<string>();
  const boards: BoardEntry[] = [];
  for (const entry of list.boards) {
    if (isBoardEntry(entry) && !seen.has(entry.id)) {
      seen.add(entry.id);
      boards.push({ id: entry.id, name: entry.name, board: normalizeBoard(entry.board) });
    }
  }
  if (boards.length === 0) {
    return null;
  }
  return { boards, currentId: seen.has(list.currentId) ? list.currentId : boards[0].id };
}

// A valid v2 value wins; otherwise the legacy single board becomes "My board"; otherwise one empty board.
// Corrupt v2 data does not consult the legacy key.
export function loadBoards(storage: Storage | undefined = globalThis.localStorage): BoardList {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      return (isBoardList(parsed) && normalizeBoardList(parsed)) || initialBoardList();
    }
    const legacy = storage?.getItem(LEGACY_STORAGE_KEY);
    if (legacy) {
      const parsed: unknown = JSON.parse(legacy);
      if (isBoard(parsed)) {
        const list = initialBoardList();
        return { ...list, boards: [{ id: list.currentId, name: DEFAULT_BOARD_NAME, board: normalizeBoard(parsed) }] };
      }
    }
  } catch {
    // fall through to an empty list
  }
  return initialBoardList();
}

export function saveBoards(list: BoardList, storage: Storage | undefined = globalThis.localStorage): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // Storage full or blocked (e.g. private mode): keep working in memory.
  }
}
