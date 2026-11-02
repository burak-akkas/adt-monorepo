import { emptyBoard, type Board } from "./board";

export const MAX_BOARD_NAME_LENGTH = 40;
export const DEFAULT_BOARD_NAME = "My board";

export type BoardEntry = { id: string; name: string; board: Board };
export type BoardList = { boards: BoardEntry[]; currentId: string };

export type NameResult = { ok: true; name: string } | { ok: false; error: string };

export function newBoardId(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }
  return `b-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function initialBoardList(id: string = newBoardId()): BoardList {
  return { boards: [{ id, name: DEFAULT_BOARD_NAME, board: emptyBoard() }], currentId: id };
}

// `ignoreId` is the board being renamed, so it may keep its own name (e.g. with different casing).
export function validateBoardName(name: string, boards: { id: string; name: string }[], ignoreId?: string): NameResult {
  const trimmed = name.trim();
  if (!trimmed) {
    return { ok: false, error: "Board name must not be empty." };
  }
  if (trimmed.length > MAX_BOARD_NAME_LENGTH) {
    return { ok: false, error: `Board name must be at most ${MAX_BOARD_NAME_LENGTH} characters.` };
  }
  const lower = trimmed.toLowerCase();
  if (boards.some((b) => b.id !== ignoreId && b.name.toLowerCase() === lower)) {
    return { ok: false, error: "A board with this name already exists." };
  }
  return { ok: true, name: trimmed };
}

// Appends an empty board and makes it current. An invalid name returns the list unchanged.
export function createBoardEntry(list: BoardList, name: string, id: string = newBoardId()): BoardList {
  const result = validateBoardName(name, list.boards);
  if (!result.ok || list.boards.some((b) => b.id === id)) {
    return list;
  }
  return { boards: [...list.boards, { id, name: result.name, board: emptyBoard() }], currentId: id };
}

// "<name> (copy)", then "(copy 2)", "(copy 3)"... The base name is truncated so the suffix fits and the name is unique.
export function copyBoardName(baseName: string, boards: { id: string; name: string }[]): string {
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? " (copy)" : ` (copy ${n})`;
    const base = baseName.trim().slice(0, Math.max(1, MAX_BOARD_NAME_LENGTH - suffix.length)).trim();
    const result = validateBoardName(`${base}${suffix}`, boards);
    if (result.ok) {
      return result.name;
    }
  }
}

// Appends a deep copy of board `id` (without archive and activity) and makes it current.
// Card, list and checklist ids are scoped per board, so they stay as they are.
export function duplicateBoardEntry(list: BoardList, id: string, newId: string = newBoardId()): BoardList {
  const source = list.boards.find((b) => b.id === id);
  if (!source || list.boards.some((b) => b.id === newId)) {
    return list;
  }
  const board: Board = JSON.parse(JSON.stringify(source.board));
  board.archive = [];
  for (const cards of Object.values(board.columns)) {
    for (const card of cards) {
      delete card.activity;
    }
  }
  const name = copyBoardName(source.name, list.boards);
  return { boards: [...list.boards, { id: newId, name, board }], currentId: newId };
}

export function renameBoard(list: BoardList, id: string, name: string): BoardList {
  const result = validateBoardName(name, list.boards, id);
  if (!result.ok || !list.boards.some((b) => b.id === id)) {
    return list;
  }
  return { ...list, boards: list.boards.map((b) => (b.id === id ? { ...b, name: result.name } : b)) };
}

// The last remaining board cannot be deleted. Deleting the current board selects the first remaining one.
export function deleteBoardEntry(list: BoardList, id: string): BoardList {
  if (list.boards.length <= 1 || !list.boards.some((b) => b.id === id)) {
    return list;
  }
  const boards = list.boards.filter((b) => b.id !== id);
  return { boards, currentId: list.currentId === id ? boards[0].id : list.currentId };
}

export function selectBoard(list: BoardList, id: string): BoardList {
  if (id === list.currentId || !list.boards.some((b) => b.id === id)) {
    return list;
  }
  return { ...list, currentId: id };
}

// Which board a ?board= value points at: a known id wins, an unknown id falls back to the first board,
// and no value keeps the remembered current board.
export function resolveBoardId(list: { boards: { id: string }[]; currentId: string }, param: string | null): string {
  if (param === null) {
    return list.currentId;
  }
  return list.boards.some((b) => b.id === param) ? param : list.boards[0].id;
}

// The relative URL that selects a board. Relative, so it works under any sub-path.
export function boardQuery(id: string): string {
  return `?board=${encodeURIComponent(id)}`;
}

// The absolute link to a board, resolved against the page's current URL (base).
export function boardLink(id: string, base: string): string {
  return new URL(boardQuery(id), base).href;
}

export function currentEntry(list: BoardList): BoardEntry {
  return list.boards.find((b) => b.id === list.currentId) ?? list.boards[0];
}

export function updateCurrentBoard(list: BoardList, change: (board: Board) => Board): BoardList {
  return {
    ...list,
    boards: list.boards.map((b) => (b.id === list.currentId ? { ...b, board: change(b.board) } : b)),
  };
}
