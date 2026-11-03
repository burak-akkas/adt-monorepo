"use client";

import { boardDetailSchema, boardSummarySchema, DEFAULT_BOARD_NAME, DEFAULT_LIST_NAMES, type BoardDetail, type BoardSummary } from "@adt/contracts";
import { useSyncExternalStore } from "react";
import { z } from "zod";
import { ApiError, apiRequest, importBoard } from "@/lib/api-client";
import type { Board } from "@/lib/board";
import { detailToBoard, withClientIds } from "@/lib/boardDetail";
import { diffBoard, runOperations } from "@/lib/boardSync";
import { currentEntry, initialBoardList, validateBoardName, type NameResult } from "@/lib/boards";
import { toImportRequest } from "@/lib/localImport";

// The board store over the API. The shown board is updated at once; the changes are sent in order, one queue per board.
// A failed save puts the saved version back and says so.

export const CURRENT_BOARD_STORAGE_KEY = "kanban-current-board-v1";
export const SAVE_ERROR_PREFIX = "Could not save, the board was reset to the saved version.";
export const CHANGED_ELSEWHERE = "This board was changed somewhere else, so it was updated to the latest version.";
const RELOAD_ERROR = "Could not load your boards. Reload the page to try again.";

type Status = "loading" | "ready" | "error";

interface State {
  boards: { id: string; name: string }[];
  currentId: string;
  board: Board;
  status: Status;
  error: string | null;
}

const LOADING = initialBoardList("server");
const INITIAL: State = {
  boards: LOADING.boards.map(({ id, name }) => ({ id, name })),
  currentId: LOADING.currentId,
  board: currentEntry(LOADING).board,
  status: "loading",
  error: null,
};

let state: State = INITIAL;
let started = false;
const listeners = new Set<() => void>();

function setState(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  void start();
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = () => state;
const getServerSnapshot = () => INITIAL;

interface Queue {
  chain: Promise<void>;
  pending: number;
  // Bumped when a save fails: jobs queued before that are skipped.
  generation: number;
  // client id -> server id, for what this board made up since its last refetch.
  ids: Map<string, string>;
  // Something was created since the shown board was last replaced by the server's copy.
  swapNeeded: boolean;
}

const queues = new Map<string, Queue>();

// Bumped by every local edit, so a catch-up fetch can tell the user changed something while it ran.
let localVersion = 0;
// A catch-up was asked for while saves were running: it runs when they are done.
let catchUpWanted = false;
let catchingUp: Promise<void> | null = null;
// Board-level calls (create, rename, delete...) that are running.
let boardCalls = 0;

function queueFor(boardId: string): Queue {
  let queue = queues.get(boardId);
  if (!queue) {
    queue = { chain: Promise.resolve(), pending: 0, generation: 0, ids: new Map(), swapNeeded: false };
    queues.set(boardId, queue);
  }
  return queue;
}

function messageOf(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "Unknown error.";
}

function saveFailure(error: unknown): string {
  if (error instanceof ApiError && (error.kind === "not-found" || error.kind === "conflict")) {
    return CHANGED_ELSEWHERE;
  }
  return `${SAVE_ERROR_PREFIX} ${messageOf(error)}`;
}

function readStoredId(): string | null {
  try {
    return localStorage.getItem(CURRENT_BOARD_STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeId(id: string) {
  try {
    localStorage.setItem(CURRENT_BOARD_STORAGE_KEY, id);
  } catch {
    // A preference only: the first board is chosen next time.
  }
}

const fetchList = () => apiRequest("/boards", { schema: z.array(boardSummarySchema) });
// A board without a stored Doing / Done choice finds those lists by name, which stops working once one is renamed.
// So the lists found by name are stored the first time the board is read. Best effort: a failure changes nothing.
async function storeInsightsDefaults(detail: BoardDetail): Promise<BoardDetail> {
  const { doingListId, doneListId } = detail.settings;
  if (doingListId !== null || doneListId !== null) {
    return detail;
  }
  const named = (name: string) => detail.lists.find((l) => l.name.trim().toLowerCase() === name)?.id ?? null;
  const doing = named("doing");
  const done = named("done");
  if (doing === null && done === null) {
    return detail;
  }
  try {
    await apiRequest(`/boards/${encodeURIComponent(detail.id)}/settings`, {
      method: "PATCH",
      body: { ...(doing !== null && { doingListId: doing }), ...(done !== null && { doneListId: done }) },
    });
  } catch {
    return detail;
  }
  return { ...detail, settings: { ...detail.settings, doingListId: doing, doneListId: done } };
}

const fetchDetail = async (id: string) =>
  storeInsightsDefaults(await apiRequest(`/boards/${encodeURIComponent(id)}`, { schema: boardDetailSchema }));

const summaries = (boards: BoardSummary[]) => boards.map(({ id, name }) => ({ id, name }));

// Shows a fetched board if it is still the one being looked at.
function showDetail(detail: BoardDetail) {
  if (detail.id === state.currentId) {
    const queue = queueFor(detail.id);
    // Cards the client made up keep their ids on screen (an open card dialog stays open); `ids` still maps them.
    queue.swapNeeded = false;
    setState({ board: withClientIds(detailToBoard(detail), queue.ids) });
  }
}

async function loadAll(preferredId: string | null, name: string | null = null) {
  let list = await fetchList();
  if (list.length === 0) {
    list = [await apiRequest("/boards", { method: "POST", body: { name: name ?? DEFAULT_BOARD_NAME }, schema: boardSummarySchema })];
  }
  const id = list.find((b) => b.id === preferredId)?.id ?? list[0].id;
  const detail = await fetchDetail(id);
  storeId(id);
  state = { ...state, boards: summaries(list), currentId: id };
  queueFor(id).ids.clear();
  setState({ board: detailToBoard(detail), status: "ready", error: null });
}

function start(): Promise<void> {
  if (started) {
    return Promise.resolve();
  }
  started = true;
  window.addEventListener("focus", onFocus);
  document.addEventListener("visibilitychange", onVisibility);
  return loadAll(readStoredId()).catch((error: unknown) => {
    setState({ status: "error", error: `${RELOAD_ERROR} ${messageOf(error)}` });
  });
}

// After a failure anywhere: show what the server has, with a message. Never silent.
async function recover(error: unknown, boardId: string, message = saveFailure(error)) {
  const queue = queueFor(boardId);
  queue.generation++;
  try {
    const list = await fetchList();
    const id = list.some((b) => b.id === state.currentId) ? state.currentId : (list[0]?.id ?? state.currentId);
    const detail = await fetchDetail(id);
    state = { ...state, boards: summaries(list), currentId: id };
    storeId(id);
    queueFor(id).ids.clear();
    setState({ board: detailToBoard(detail), error: message, status: "ready" });
  } catch (refetchError) {
    setState({ status: "error", error: `${message} ${RELOAD_ERROR} ${messageOf(refetchError)}` });
  } finally {
    // Changes made while the refetch ran were built on a board that is gone.
    queue.generation++;
  }
}

function runWantedCatchUp(queue: Queue) {
  if (catchUpWanted && queue.pending === 0 && boardCalls === 0) {
    catchUpWanted = false;
    void catchUp();
  }
}

// Shows what the server has now (the board and the list of boards), e.g. when the tab is used again after
// another tab changed things. It only ever replaces the shown board: local changes are never sent again.
function catchUp(): Promise<void> {
  if (state.status !== "ready") {
    return Promise.resolve();
  }
  if (catchingUp) {
    return catchingUp;
  }
  const id = state.currentId;
  const queue = queueFor(id);
  if (queue.pending > 0 || boardCalls > 0) {
    catchUpWanted = true;
    return Promise.resolve();
  }
  const version = localVersion;
  const run = (async () => {
    try {
      const list = await fetchList();
      const detail = await fetchDetail(id);
      if (localVersion !== version || queue.pending > 0 || boardCalls > 0 || state.currentId !== id || state.status !== "ready") {
        // The user changed something meanwhile: that wins, and the next catch-up picks the rest up.
        return;
      }
      state = { ...state, boards: summaries(list) };
      showDetail(detail);
    } catch (error) {
      if (error instanceof ApiError && error.kind === "not-found" && state.currentId === id) {
        await recover(error, id, CHANGED_ELSEWHERE);
      }
      // Anything else (network, server): nothing was lost, the next focus tries again.
    } finally {
      catchingUp = null;
    }
  })();
  catchingUp = run;
  return run;
}

function onFocus() {
  void catchUp();
}

function onVisibility() {
  if (document.visibilityState === "visible") {
    void catchUp();
  }
}

function enqueue(boardId: string, job: () => Promise<void>) {
  const queue = queueFor(boardId);
  const generation = queue.generation;
  queue.pending++;
  queue.chain = queue.chain.then(async () => {
    try {
      if (generation !== queue.generation) {
        return;
      }
      const known = queue.ids.size;
      await job();
      if (queue.ids.size > known) {
        queue.swapNeeded = true;
      }
      // Creates left client ids behind: once nothing else is queued, swap in the server's board.
      if (queue.swapNeeded && queue.pending === 1 && boardId === state.currentId) {
        const detail = await fetchDetail(boardId);
        if (queue.pending === 1) {
          showDetail(detail);
        }
      }
    } catch (error) {
      await recover(error, boardId);
    } finally {
      queue.pending--;
      runWantedCatchUp(queue);
    }
  });
}

function update(change: (board: Board) => Board) {
  const boardId = state.currentId;
  if (state.status !== "ready") {
    return;
  }
  const prev = state.board;
  const next = change(prev);
  if (next === prev) {
    return;
  }
  localVersion++;
  setState({ board: next });
  const queue = queueFor(boardId);
  let operations;
  try {
    operations = diffBoard(prev, next);
  } catch (error) {
    // Cannot be sent: same path as a failed save, after what is queued has run.
    enqueue(boardId, () => Promise.reject(error));
    return;
  }
  if (operations.length === 0) {
    return;
  }
  enqueue(boardId, () => runOperations(operations, { boardId, ids: queue.ids }));
}

// Board-level calls go through the board's own queue, so they run after its pending saves.
async function boardCall(work: () => Promise<void>) {
  const boardId = state.currentId;
  const queue = queueFor(boardId);
  boardCalls++;
  const run = queue.chain.then(work);
  queue.chain = run.catch(() => undefined);
  try {
    await run;
  } catch (error) {
    await recover(error, boardId);
  } finally {
    boardCalls--;
    runWantedCatchUp(queue);
  }
}

// While another board loads the shown one is hidden: a change made then would go to the board being left.
function beginSwitch() {
  setState({ status: "loading" });
}

async function switchTo(id: string) {
  // Remembered at once, so a reload before the board has arrived still opens it.
  storeId(id);
  const detail = await fetchDetail(id);
  state = { ...state, currentId: id };
  queueFor(id).ids.clear();
  setState({ board: detailToBoard(detail), error: null, status: "ready" });
}

function addBoard(summary: BoardSummary) {
  state = { ...state, boards: [...state.boards, { id: summary.id, name: summary.name }] };
}

function createBoard(name: string): NameResult {
  const result = validateBoardName(name, state.boards);
  if (result.ok) {
    beginSwitch();
    void boardCall(async () => {
      const created = await apiRequest("/boards", { method: "POST", body: { name: result.name }, schema: boardSummarySchema });
      addBoard(created);
      // The API makes an empty board: give it the same three lists as the first one.
      for (const listName of DEFAULT_LIST_NAMES) {
        await apiRequest(`/boards/${encodeURIComponent(created.id)}/lists`, { method: "POST", body: { name: listName } });
      }
      await switchTo(created.id);
    });
  }
  return result;
}

function renameBoard(id: string, name: string): NameResult {
  const result = validateBoardName(name, state.boards, id);
  if (result.ok) {
    localVersion++;
    setState({ boards: state.boards.map((b) => (b.id === id ? { ...b, name: result.name } : b)) });
    void boardCall(async () => {
      await apiRequest(`/boards/${encodeURIComponent(id)}`, { method: "PATCH", body: { name: result.name } });
    });
  }
  return result;
}

function duplicateBoard() {
  const id = state.currentId;
  beginSwitch();
  void boardCall(async () => {
    const copy = await apiRequest(`/boards/${encodeURIComponent(id)}/duplicate`, { method: "POST", schema: boardSummarySchema });
    addBoard(copy);
    await switchTo(copy.id);
  });
}

function deleteBoard(id: string) {
  if (state.boards.length <= 1 || !state.boards.some((b) => b.id === id)) {
    return;
  }
  const index = state.boards.findIndex((b) => b.id === id);
  const remaining = state.boards.filter((b) => b.id !== id);
  const wasCurrent = id === state.currentId;
  const neighbour = remaining[Math.min(index, remaining.length - 1)];
  setState({ boards: remaining, ...(wasCurrent && { status: "loading" as const }) });
  void boardCall(async () => {
    await apiRequest(`/boards/${encodeURIComponent(id)}`, { method: "DELETE" });
    queues.delete(id);
    if (wasCurrent) {
      await switchTo(neighbour.id);
    }
  });
}

function selectBoard(id: string) {
  if (id === state.currentId || !state.boards.some((b) => b.id === id)) {
    return;
  }
  // The call takes the queue of the board being left; then the chosen board becomes the current one at once
  // (the URL and the select follow), and its content is shown when it has loaded.
  void boardCall(() => switchTo(id));
  storeId(id);
  setState({ currentId: id, status: "loading" });
}

function importBoardFile(board: Board, name: string) {
  beginSwitch();
  void boardCall(async () => {
    const { board: detail } = await importBoard(toImportRequest({ id: "import", name, board }, globalThis.crypto.randomUUID()));
    addBoard(detail);
    await switchTo(detail.id);
  });
}

// Reads the list again, e.g. after boards were imported from this browser.
export async function refreshBoards() {
  if (!started) {
    return;
  }
  try {
    await loadAll(state.currentId);
  } catch (error) {
    setState({ status: "error", error: `${RELOAD_ERROR} ${messageOf(error)}` });
  }
}

function dismissError() {
  setState({ error: null });
}

export function useServerBoard() {
  const current = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return [current.board, update] as const;
}

export function useServerBoards() {
  const current = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return {
    boards: current.boards,
    currentId: current.currentId,
    ready: current.status === "ready",
    createBoard,
    renameBoard,
    duplicateBoard,
    deleteBoard,
    selectBoard,
    importBoardFile,
  };
}

export function useServerSaveError() {
  const current = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return { error: current.error, dismiss: dismissError };
}

// Tests only: forget everything so the next hook starts a fresh load.
export function resetServerBoardStore() {
  state = INITIAL;
  started = false;
  queues.clear();
  localVersion = 0;
  catchUpWanted = false;
  catchingUp = null;
  boardCalls = 0;
  window.removeEventListener("focus", onFocus);
  document.removeEventListener("visibilitychange", onVisibility);
}
