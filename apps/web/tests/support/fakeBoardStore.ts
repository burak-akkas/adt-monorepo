"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { Board } from "@/lib/board";
import {
  createBoardEntry,
  currentEntry,
  deleteBoardEntry,
  duplicateBoardEntry,
  initialBoardList,
  renameBoard as renameBoardEntry,
  selectBoard as selectBoardEntry,
  updateCurrentBoard,
  validateBoardName,
  type BoardList,
  type NameResult,
} from "@/lib/boards";
import { loadBoards, STORAGE_KEY } from "@/lib/storage";
import { saveBoards } from "./testStorage";

// Test double for hooks/serverBoardStore: the same hooks over boards kept in localStorage,
// so component tests can seed a board with saveBoard() and need no API. Installed in vitest.setup.ts.

const NO_SAVE_ERROR = { error: null, dismiss: () => {} };

const SERVER_LIST = initialBoardList("server");
const listeners = new Set<() => void>();
let cache: BoardList | null = null;

function getSnapshot(): BoardList {
  cache ??= loadBoards();
  return cache;
}

function getServerSnapshot(): BoardList {
  return SERVER_LIST;
}

function notify() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Keep several open tabs in sync.
  const onStorage = (event: StorageEvent) => {
    // A null key means the whole storage was cleared.
    if (event.key === STORAGE_KEY || event.key === null) {
      cache = null;
      listener();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function commit(next: BoardList) {
  if (next === getSnapshot()) {
    return;
  }
  cache = next;
  saveBoards(next);
  notify();
}

export function useServerBoard() {
  const list = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const update = useCallback((change: (board: Board) => Board) => {
    commit(updateCurrentBoard(getSnapshot(), change));
  }, []);
  return [currentEntry(list).board, update] as const;
}

export function useServerBoards() {
  const list = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const boards = useMemo(() => list.boards.map(({ id, name }) => ({ id, name })), [list.boards]);
  const createBoard = useCallback((name: string): NameResult => {
    const current = getSnapshot();
    const result = validateBoardName(name, current.boards);
    if (result.ok) {
      commit(createBoardEntry(current, result.name));
    }
    return result;
  }, []);
  const renameBoard = useCallback((id: string, name: string): NameResult => {
    const current = getSnapshot();
    const result = validateBoardName(name, current.boards, id);
    if (result.ok) {
      commit(renameBoardEntry(current, id, result.name));
    }
    return result;
  }, []);
  const duplicateBoard = useCallback(() => {
    const current = getSnapshot();
    commit(duplicateBoardEntry(current, current.currentId));
  }, []);
  const deleteBoard = useCallback((id: string) => commit(deleteBoardEntry(getSnapshot(), id)), []);
  const leaveBoard = deleteBoard;
  const selectBoard = useCallback((id: string) => commit(selectBoardEntry(getSnapshot(), id)), []);
  return { boards, currentId: list.currentId, ready: true, createBoard, renameBoard, duplicateBoard, deleteBoard, leaveBoard, selectBoard };
}

export function useServerSaveError() {
  return NO_SAVE_ERROR;
}

export async function refreshBoards() {
  cache = null;
  notify();
}

// Forget the cached boards so the next read comes from storage.
export function resetServerBoardStore() {
  cache = null;
}
