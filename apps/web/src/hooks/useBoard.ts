"use client";

import type { Board } from "@/lib/board";
import type { NameResult } from "@/lib/boards";
import { USE_SERVER_BOARDS } from "@/lib/config";
import { resetLocalBoardStore, useLocalBoard, useLocalBoards } from "./localBoardStore";
import { resetServerBoardStore, useServerBoard, useServerBoards, useServerSaveError } from "./serverBoardStore";

// One public surface over two stores: the browser's localStorage, or the API (USE_SERVER_BOARDS).
// The choice is made once, at module level, so each hook always runs the same implementation.

export interface BoardsApi {
  boards: { id: string; name: string }[];
  currentId: string;
  // False while the boards are loading from the server.
  ready: boolean;
  createBoard: (name: string) => NameResult;
  renameBoard: (id: string, name: string) => NameResult;
  duplicateBoard: () => void;
  deleteBoard: (id: string) => void;
  selectBoard: (id: string) => void;
  // Server boards only: adds the board as a new one. Undefined in the local store.
  importBoardFile?: (board: Board, name: string) => void;
}

type Update = (change: (board: Board) => Board) => void;

const NO_SAVE_ERROR = { error: null, dismiss: () => {} };

export function useBoard(): readonly [Board, Update] {
  // eslint-disable-next-line react-hooks/rules-of-hooks -- a module constant, never changes between renders
  return USE_SERVER_BOARDS ? useServerBoard() : useLocalBoard();
}

export function useBoards(): BoardsApi {
  if (USE_SERVER_BOARDS) {
    // eslint-disable-next-line react-hooks/rules-of-hooks -- a module constant, never changes between renders
    return useServerBoards();
  }
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const local = useLocalBoards();
  return { ...local, ready: true };
}

export function useSaveError(): { error: string | null; dismiss: () => void } {
  // eslint-disable-next-line react-hooks/rules-of-hooks -- a module constant, never changes between renders
  return USE_SERVER_BOARDS ? useServerSaveError() : NO_SAVE_ERROR;
}

// Tests only: forget the cached boards so the next read starts again.
export function resetBoardStore() {
  resetLocalBoardStore();
  resetServerBoardStore();
}
