// Test-only helpers: seed and read the current board through the multi-board storage shape.
import type { Board } from "@/lib/board";
import { currentEntry, updateCurrentBoard } from "@/lib/boards";
import type { BoardList } from "@/lib/boards";
import { loadBoards, STORAGE_KEY } from "@/lib/storage";

export function saveBoards(list: BoardList, storage: Storage | undefined = globalThis.localStorage): void {
  storage?.setItem(STORAGE_KEY, JSON.stringify(list));
}

export function saveBoard(board: Board, storage: Storage | undefined = globalThis.localStorage): void {
  saveBoards(updateCurrentBoard(loadBoards(storage), () => board), storage);
}

export function loadBoard(storage: Storage | undefined = globalThis.localStorage): Board {
  return currentEntry(loadBoards(storage)).board;
}
