// Test-only helpers: seed and read the current board through the multi-board storage shape.
import type { Board } from "@/lib/board";
import { currentEntry, updateCurrentBoard } from "@/lib/boards";
import { loadBoards, saveBoards } from "@/lib/storage";

export function saveBoard(board: Board, storage: Storage | undefined = globalThis.localStorage): void {
  saveBoards(updateCurrentBoard(loadBoards(storage), () => board), storage);
}

export function loadBoard(storage: Storage | undefined = globalThis.localStorage): Board {
  return currentEntry(loadBoards(storage)).board;
}
