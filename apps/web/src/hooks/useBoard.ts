"use client";

import type { Board } from "@/lib/board";
import type { NameResult } from "@/lib/boards";
import { resetServerBoardStore, useServerBoard, useServerBoards, useServerSaveError } from "./serverBoardStore";

// The public surface over the boards stored on the server.

export interface BoardsApi {
  // `role` is absent for a board the user owns.
  boards: { id: string; name: string; role?: "owner" | "editor" }[];
  currentId: string;
  // False while the boards are loading from the server.
  ready: boolean;
  createBoard: (name: string) => NameResult;
  renameBoard: (id: string, name: string) => NameResult;
  duplicateBoard: () => void;
  deleteBoard: (id: string) => void;
  // For a board shared with the user: they stop having access.
  leaveBoard: (id: string) => void;
  selectBoard: (id: string) => void;
  // Adds the board as a new one.
  importBoardFile?: (board: Board, name: string) => void;
}

type Update = (change: (board: Board) => Board) => void;

export function useBoard(): readonly [Board, Update] {
  return useServerBoard();
}

export function useBoards(): BoardsApi {
  return useServerBoards();
}

export function useSaveError(): { error: string | null; dismiss: () => void } {
  return useServerSaveError();
}

// Tests only: forget the cached boards so the next read starts again.
export function resetBoardStore() {
  resetServerBoardStore();
}
