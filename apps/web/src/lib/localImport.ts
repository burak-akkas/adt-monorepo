import type { ImportBoardRequest } from "@adt/contracts";
import { ApiError, importBoard as postBoard } from "./api-client";
import { boardLists, insightsListIds, type Board, type Card } from "./board";
import type { BoardEntry } from "./boards";
import { LEGACY_STORAGE_KEY, loadBoards, STORAGE_KEY } from "./storage";

// localBoardId -> importKey. Kept apart from the boards, which storage.ts normalizes and would strip unknown fields from.
export const IMPORT_KEYS_STORAGE_KEY = "kanban-import-keys-v1";
// Set once every local board is on the server. A per-browser flag, not user data.
export const IMPORT_DONE_STORAGE_KEY = "kanban-import-done-v1";

type ImportCard = NonNullable<ImportBoardRequest["lists"][number]["cards"]>[number];

function readKeys(storage: Storage | undefined): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(IMPORT_KEYS_STORAGE_KEY) ?? "{}");
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    return Object.fromEntries(Object.entries(parsed).filter((e): e is [string, string] => typeof e[1] === "string"));
  } catch {
    return {};
  }
}

// The same key for the same local board, every time: a retry or a second tab reuses it and the server dedupes.
export function getImportKey(localId: string, storage: Storage | undefined = globalThis.localStorage): string {
  const existing = readKeys(storage)[localId];
  if (existing) {
    return existing;
  }
  const fresh = globalThis.crypto.randomUUID();
  try {
    storage?.setItem(IMPORT_KEYS_STORAGE_KEY, JSON.stringify({ ...readKeys(storage), [localId]: fresh }));
  } catch {
    return fresh;
  }
  // Another tab may have written one in between: keep what is stored.
  return readKeys(storage)[localId] ?? fresh;
}

function toImportCard(card: Card): ImportCard {
  return {
    title: card.title,
    priority: card.priority,
    ...(card.cover !== undefined && { cover: card.cover }),
    ...(card.dueDate !== undefined && { dueDate: card.dueDate }),
    ...(card.notes !== undefined && { notes: card.notes }),
    createdAt: card.createdAt,
    checklist: (card.checklist ?? []).map(({ text, done }) => ({ text, done })),
    comments: (card.comments ?? []).map(({ text, createdAt, editedAt }) => ({ text, createdAt, ...(editedAt !== undefined && { editedAt }) })),
    labels: card.labels ?? [],
    activity: (card.activity ?? []).map(({ type, at, from, to }) => ({
      type,
      at,
      ...(from !== undefined && { from }),
      ...(to !== undefined && { to }),
    })),
  };
}

// When an archived card was archived: its newest "archived" entry, else the day it was created.
function archivedAt(card: Card): string {
  const times = (card.activity ?? []).filter((a) => a.type === "archived").map((a) => a.at);
  return times.reduce((latest, at) => (new Date(at) > new Date(latest) ? at : latest), times[0] ?? card.createdAt);
}

export function toImportRequest(entry: BoardEntry, importKey: string): ImportBoardRequest {
  const board: Board = entry.board;
  const collapsed = new Set(board.collapsedLists ?? []);
  const { doing, done } = insightsListIds(board);
  return {
    importKey,
    name: entry.name,
    lists: boardLists(board).map((list) => {
      const wipLimit = board.wipLimits?.[list.id];
      return {
        id: list.id,
        name: list.name,
        ...(wipLimit !== undefined && { wipLimit }),
        collapsed: collapsed.has(list.id),
        cards: (board.columns[list.id] ?? []).map(toImportCard),
      };
    }),
    archive: board.archive.map((card) => ({ ...toImportCard(card), archivedAt: archivedAt(card) })),
    templates: (board.templates ?? []).map((t) => ({
      name: t.name,
      title: t.title,
      priority: t.priority,
      ...(t.notes !== undefined && { notes: t.notes }),
      labels: t.labels ?? [],
      ...(t.cover !== undefined && { cover: t.cover }),
      checklist: (t.checklist ?? []).map((i) => i.text),
    })),
    formerLists: board.formerLists ?? {},
    settings: {
      background: board.background ?? null,
      view: board.view ?? "board",
      doingListId: doing ?? null,
      doneListId: done ?? null,
    },
  };
}

// True while there is saved board data that has not been imported yet.
// Empty storage does not count: loadBoards would invent an empty default board.
export function hasLocalBoards(storage: Storage | undefined = globalThis.localStorage): boolean {
  try {
    if (storage?.getItem(IMPORT_DONE_STORAGE_KEY)) {
      return false;
    }
    return Boolean(storage?.getItem(STORAGE_KEY) || storage?.getItem(LEGACY_STORAGE_KEY));
  } catch {
    return false;
  }
}

export interface FailedBoard {
  id: string;
  name: string;
  board: Board;
  error: ApiError;
  // True when trying again can help (network, server, rate limit); false for rejected content.
  transient: boolean;
}

export type LocalImportResult =
  | { status: "nothing" }
  | { status: "done"; imported: number; alreadyImported: number; failed: FailedBoard[] };

export interface LockManagerLike {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>;
}

export interface ImportLocalOptions {
  storage?: Storage;
  importBoard?: typeof postBoard;
  locks?: LockManagerLike;
}

export const IMPORT_LOCK_NAME = "kanban-local-import";

export function isTransientError(error: ApiError): boolean {
  return error.kind === "network" || error.kind === "server" || error.kind === "rate-limited";
}

function removeImportKey(storage: Storage, localId: string): void {
  const rest = readKeys(storage);
  delete rest[localId];
  storage.setItem(IMPORT_KEYS_STORAGE_KEY, JSON.stringify(rest));
}

async function runImport(storage: Storage, importBoard: typeof postBoard): Promise<LocalImportResult> {
  // Read inside the lock: a second tab that waited sees what the first one left.
  if (!hasLocalBoards(storage)) {
    return { status: "nothing" };
  }
  const list = loadBoards(storage);
  try {
    // A legacy board gets a random id on every load; store it so its importKey stays the same between runs.
    if (!storage.getItem(STORAGE_KEY)) {
      storage.setItem(STORAGE_KEY, JSON.stringify(list));
    }
  } catch {
    // Blocked storage: re-imports are still deduped by key where keys could be stored.
  }
  let remaining = list.boards;
  let imported = 0;
  let alreadyImported = 0;
  const failed: FailedBoard[] = [];
  for (const entry of list.boards) {
    try {
      const { created } = await importBoard(toImportRequest(entry, getImportKey(entry.id, storage)));
      if (created) {
        imported++;
      } else {
        alreadyImported++;
      }
    } catch (error) {
      const apiError = error instanceof ApiError ? error : new ApiError("network", 0, "The import failed.");
      failed.push({ id: entry.id, name: entry.name, board: entry.board, error: apiError, transient: isTransientError(apiError) });
      continue;
    }
    // Only this board is on the server now: drop it from the browser, keep the others.
    remaining = remaining.filter((b) => b.id !== entry.id);
    try {
      if (remaining.length > 0) {
        const currentId = remaining.some((b) => b.id === list.currentId) ? list.currentId : remaining[0].id;
        storage.setItem(STORAGE_KEY, JSON.stringify({ boards: remaining, currentId }));
      }
      removeImportKey(storage, entry.id);
    } catch {
      // The board is on the server; a re-import is deduped by its key.
    }
  }
  if (remaining.length === 0) {
    try {
      storage.removeItem(STORAGE_KEY);
      storage.removeItem(IMPORT_KEYS_STORAGE_KEY);
      // The legacy key is never removed (see storage.ts), so this marker keeps it from being imported again.
      storage.setItem(IMPORT_DONE_STORAGE_KEY, "1");
    } catch {
      // The boards are on the server; a blocked storage only means the clean-up is retried (and deduped by key).
    }
  }
  return { status: "done", imported, alreadyImported, failed };
}

// Posts every local board on its own: a failing board does not stop the others.
// Only the boards that made it to the server leave the browser. Calling it again retries the rest.
export async function importLocalBoards({
  storage = globalThis.localStorage,
  importBoard = postBoard,
  locks = globalThis.navigator?.locks,
}: ImportLocalOptions = {}): Promise<LocalImportResult> {
  if (locks) {
    return locks.request(IMPORT_LOCK_NAME, () => runImport(storage, importBoard));
  }
  return runImport(storage, importBoard);
}
