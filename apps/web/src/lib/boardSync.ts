import {
  cardResponseSchema,
  listResponseSchema,
  templateResponseSchema,
  type UpdateBoardSettingsRequest,
  type UpdateCardRequest,
} from "@adt/contracts";
import type { ZodType } from "zod";
import { apiRequest, type ApiRequestOptions } from "./api-client";
import { boardLists, boardView, listCards, type Board, type Card } from "./board";

// What the server has to be told, in the order to tell it. Ids may be ones the client made up: `runOperations` maps them.
export type Operation =
  | { kind: "createList"; id: string; name: string }
  | { kind: "renameList"; id: string; name: string }
  | { kind: "moveList"; id: string; position: number }
  | { kind: "deleteList"; id: string }
  | { kind: "setWipLimit"; id: string; limit: number | null }
  | { kind: "createCard"; id: string; listId: string; card: Card }
  | { kind: "duplicateCard"; id: string; sourceId: string }
  | { kind: "updateCard"; id: string; patch: UpdateCardRequest }
  | { kind: "addLabel"; cardId: string; name: string }
  | { kind: "removeLabel"; cardId: string; name: string }
  | { kind: "addChecklistItem"; cardId: string; id: string; text: string }
  | { kind: "updateChecklistItem"; cardId: string; id: string; text?: string; done?: boolean }
  | { kind: "deleteChecklistItem"; cardId: string; id: string }
  | { kind: "reorderChecklist"; cardId: string; itemIds: string[] }
  | { kind: "addComment"; cardId: string; id: string; text: string }
  | { kind: "editComment"; cardId: string; id: string; text: string }
  | { kind: "deleteComment"; cardId: string; id: string }
  | { kind: "moveCard"; id: string; listId: string; position: number }
  | { kind: "reorderCards"; listId: string; cardIds: string[] }
  | { kind: "archiveCard"; id: string }
  | { kind: "archiveList"; listId: string }
  | { kind: "restoreCard"; id: string; listId: string }
  | { kind: "deleteArchived"; id: string }
  | { kind: "emptyArchive" }
  | { kind: "deleteCard"; id: string }
  | { kind: "createTemplate"; id: string; template: NonNullable<Board["templates"]>[number] }
  | { kind: "renameTemplate"; id: string; name: string }
  | { kind: "deleteTemplate"; id: string }
  | { kind: "updateSettings"; patch: UpdateBoardSettingsRequest };

// A change the sync cannot express. The caller shows the "could not save" message and refetches.
export class UnsupportedChangeError extends Error {
  constructor(what: string) {
    super(`Cannot save this change: ${what}`);
    this.name = "UnsupportedChangeError";
  }
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function allCards(board: Board): Map<string, { card: Card; listId: string | null }> {
  const cards = new Map<string, { card: Card; listId: string | null }>();
  for (const list of boardLists(board)) {
    for (const card of listCards(board, list.id)) {
      cards.set(card.id, { card, listId: list.id });
    }
  }
  for (const card of board.archive) {
    cards.set(card.id, { card, listId: null });
  }
  return cards;
}

function cardPatch(prev: Card, next: Card): UpdateCardRequest {
  const patch: UpdateCardRequest = {};
  if (prev.title !== next.title) {
    patch.title = next.title;
  }
  if (prev.priority !== next.priority) {
    patch.priority = next.priority;
  }
  if (prev.cover !== next.cover) {
    patch.cover = next.cover ?? null;
  }
  if (prev.dueDate !== next.dueDate) {
    patch.dueDate = next.dueDate ?? null;
  }
  if (prev.notes !== next.notes) {
    patch.notes = next.notes ?? null;
  }
  return patch;
}

// A card the server just made from `card`'s title, priority, cover, due date and notes: only labels, checklist
// and comments are left to send.
function newCardOps(card: Card): Operation[] {
  const blank: Card = { ...card, labels: [], checklist: [], comments: [] };
  return cardContentOps(blank, card);
}

// Operations for everything in a card except its list and position.
function cardContentOps(prev: Card, next: Card): Operation[] {
  const ops: Operation[] = [];
  const patch = cardPatch(prev, next);
  if (Object.keys(patch).length > 0) {
    ops.push({ kind: "updateCard", id: next.id, patch });
  }

  const before = prev.labels ?? [];
  const after = next.labels ?? [];
  let common = 0;
  while (common < before.length && common < after.length && before[common] === after[common]) {
    common++;
  }
  for (const name of before.slice(common)) {
    ops.push({ kind: "removeLabel", cardId: next.id, name });
  }
  for (const name of after.slice(common)) {
    ops.push({ kind: "addLabel", cardId: next.id, name });
  }

  const oldItems = new Map((prev.checklist ?? []).map((i) => [i.id, i]));
  const newItems = next.checklist ?? [];
  const newItemIds = new Set(newItems.map((i) => i.id));
  for (const id of oldItems.keys()) {
    if (!newItemIds.has(id)) {
      ops.push({ kind: "deleteChecklistItem", cardId: next.id, id });
    }
  }
  for (const item of newItems) {
    const old = oldItems.get(item.id);
    if (!old) {
      ops.push({ kind: "addChecklistItem", cardId: next.id, id: item.id, text: item.text });
      if (item.done) {
        ops.push({ kind: "updateChecklistItem", cardId: next.id, id: item.id, done: true });
      }
    } else if (old.text !== item.text || old.done !== item.done) {
      ops.push({
        kind: "updateChecklistItem",
        cardId: next.id,
        id: item.id,
        ...(old.text !== item.text && { text: item.text }),
        ...(old.done !== item.done && { done: item.done }),
      });
    }
  }
  const serverOrder = [...(prev.checklist ?? []).filter((i) => newItemIds.has(i.id)), ...newItems.filter((i) => !oldItems.has(i.id))].map((i) => i.id);
  if (serverOrder.join("\n") !== newItems.map((i) => i.id).join("\n")) {
    ops.push({ kind: "reorderChecklist", cardId: next.id, itemIds: newItems.map((i) => i.id) });
  }

  const oldComments = new Map((prev.comments ?? []).map((c) => [c.id, c]));
  const newComments = next.comments ?? [];
  const newCommentIds = new Set(newComments.map((c) => c.id));
  for (const id of oldComments.keys()) {
    if (!newCommentIds.has(id)) {
      ops.push({ kind: "deleteComment", cardId: next.id, id });
    }
  }
  for (const comment of newComments) {
    const old = oldComments.get(comment.id);
    if (!old) {
      ops.push({ kind: "addComment", cardId: next.id, id: comment.id, text: comment.text });
    } else if (old.text !== comment.text) {
      ops.push({ kind: "editComment", cardId: next.id, id: comment.id, text: comment.text });
    }
  }
  return ops;
}

// The operations that turn `prev` (the server's board) into `next`. Throws UnsupportedChangeError for a change
// that cannot be sent. Activity is the server's own log and is never sent.
export function diffBoard(prev: Board, next: Board): Operation[] {
  const ops: Operation[] = [];
  const prevCards = allCards(prev);
  const nextCards = allCards(next);
  const prevLists = boardLists(prev);
  const nextLists = boardLists(next);
  const prevListIds = new Set(prevLists.map((l) => l.id));
  const nextListIds = new Set(nextLists.map((l) => l.id));

  // What the server holds per list while the operations run, so positions and reorders can be worked out.
  const server = new Map<string, string[]>(prevLists.map((l) => [l.id, listCards(prev, l.id).map((c) => c.id)]));
  const removeFromServer = (cardId: string) => {
    for (const ids of server.values()) {
      const index = ids.indexOf(cardId);
      if (index !== -1) {
        ids.splice(index, 1);
      }
    }
  };

  // Lists: create, rename, wip limit.
  for (const list of nextLists) {
    if (!prevListIds.has(list.id)) {
      ops.push({ kind: "createList", id: list.id, name: list.name });
      server.set(list.id, []);
    } else if (prevLists.find((l) => l.id === list.id)?.name !== list.name) {
      ops.push({ kind: "renameList", id: list.id, name: list.name });
    }
    if ((prev.wipLimits?.[list.id] ?? null) !== (next.wipLimits?.[list.id] ?? null)) {
      ops.push({ kind: "setWipLimit", id: list.id, limit: next.wipLimits?.[list.id] ?? null });
    }
  }
  const firstList = nextLists[0]?.id;

  // Cards that are new to the server (a new card, a copy, or one brought back by undo).
  for (const list of nextLists) {
    for (const [index, card] of listCards(next, list.id).entries()) {
      if (prevCards.has(card.id)) {
        continue;
      }
      const copiedFrom = card.activity?.find((a) => a.type === "duplicated")?.from;
      const source = copiedFrom === undefined ? undefined : listCards(next, list.id)[index - 1];
      if (source && prevCards.get(source.id)?.listId === list.id && source.title === copiedFrom) {
        // The server's copy already has the source's content, with unticked items.
        ops.push({ kind: "duplicateCard", id: card.id, sourceId: source.id });
      } else {
        ops.push({ kind: "createCard", id: card.id, listId: list.id, card }, ...newCardOps(card));
      }
      server.get(list.id)?.push(card.id);
    }
  }
  for (const card of next.archive) {
    if (!prevCards.has(card.id)) {
      if (!firstList) {
        throw new UnsupportedChangeError("the board has no list");
      }
      ops.push({ kind: "createCard", id: card.id, listId: firstList, card }, ...newCardOps(card));
      server.get(firstList)?.push(card.id);
    }
  }

  // Changed content of cards the server already has (in lists).
  for (const [id, { card: before, listId }] of prevCards) {
    const after = nextCards.get(id);
    if (!after || listId === null) {
      continue;
    }
    ops.push(...cardContentOps(before, after.card));
  }

  // Restore from the archive.
  for (const [id, { listId }] of prevCards) {
    const after = nextCards.get(id);
    if (listId === null && after && after.listId !== null) {
      ops.push({ kind: "restoreCard", id, listId: after.listId });
      server.get(after.listId)?.push(id);
    }
  }

  // Archive: a whole list at once when every card of it goes.
  const archiving = next.archive.filter((c) => prevCards.get(c.id)?.listId !== null);
  const archivingIds = new Set(archiving.map((c) => c.id));
  for (const list of prevLists) {
    const ids = server.get(list.id) ?? [];
    if (ids.length > 1 && ids.every((id) => archivingIds.has(id))) {
      ops.push({ kind: "archiveList", listId: list.id });
      server.set(list.id, []);
    }
  }
  for (const card of archiving) {
    const serverList = [...server.entries()].find(([, ids]) => ids.includes(card.id));
    if (serverList) {
      ops.push({ kind: "archiveCard", id: card.id });
      removeFromServer(card.id);
    }
  }

  // Deleted archived cards.
  const removedFromArchive = prev.archive.filter((c) => !nextCards.has(c.id));
  if (removedFromArchive.length > 1 && next.archive.length === 0 && removedFromArchive.length === prev.archive.length) {
    ops.push({ kind: "emptyArchive" });
  } else {
    for (const card of removedFromArchive) {
      ops.push({ kind: "deleteArchived", id: card.id });
    }
  }

  // Deleted cards.
  for (const [id, { listId }] of prevCards) {
    if (listId !== null && !nextCards.has(id)) {
      ops.push({ kind: "deleteCard", id });
      removeFromServer(id);
    }
  }

  // Moves between lists, then the order inside each list.
  for (const list of nextLists) {
    for (const card of listCards(next, list.id)) {
      const current = [...server.entries()].find(([, ids]) => ids.includes(card.id))?.[0];
      if (current !== undefined && current !== list.id) {
        const target = server.get(list.id) ?? [];
        ops.push({ kind: "moveCard", id: card.id, listId: list.id, position: target.length });
        removeFromServer(card.id);
        target.push(card.id);
      }
    }
  }
  for (const list of nextLists) {
    const wanted = listCards(next, list.id).map((c) => c.id);
    if ((server.get(list.id) ?? []).join("\n") !== wanted.join("\n")) {
      ops.push({ kind: "reorderCards", listId: list.id, cardIds: wanted });
      server.set(list.id, wanted);
    }
  }

  // Deleted lists (empty by now) and list order.
  for (const list of prevLists) {
    if (!nextListIds.has(list.id)) {
      ops.push({ kind: "deleteList", id: list.id });
    }
  }
  const order = [...prevLists.map((l) => l.id).filter((id) => nextListIds.has(id)), ...nextLists.map((l) => l.id).filter((id) => !prevListIds.has(id))];
  for (const [index, list] of nextLists.entries()) {
    if (order[index] !== list.id) {
      ops.push({ kind: "moveList", id: list.id, position: index });
      order.splice(order.indexOf(list.id), 1);
      order.splice(index, 0, list.id);
    }
  }

  // Templates.
  const prevTemplates = new Map((prev.templates ?? []).map((t) => [t.id, t]));
  const nextTemplates = next.templates ?? [];
  for (const template of nextTemplates) {
    const old = prevTemplates.get(template.id);
    if (!old) {
      ops.push({ kind: "createTemplate", id: template.id, template });
    } else if (old.name !== template.name) {
      if (!sameJson({ ...old, name: "" }, { ...template, name: "" })) {
        throw new UnsupportedChangeError("a template changed in more than its name");
      }
      ops.push({ kind: "renameTemplate", id: template.id, name: template.name });
    } else if (!sameJson(old, template)) {
      throw new UnsupportedChangeError("a template changed in more than its name");
    }
  }
  for (const id of prevTemplates.keys()) {
    if (!nextTemplates.some((t) => t.id === id)) {
      ops.push({ kind: "deleteTemplate", id });
    }
  }

  // Settings.
  const patch: UpdateBoardSettingsRequest = {};
  if (!sameJson(prev.background, next.background)) {
    patch.background = next.background ?? null;
  }
  if (boardView(prev) !== boardView(next)) {
    patch.view = boardView(next);
  }
  const collapsedBefore = [...(prev.collapsedLists ?? [])].sort();
  const collapsedAfter = [...(next.collapsedLists ?? [])].sort();
  if (collapsedBefore.join("\n") !== collapsedAfter.join("\n")) {
    patch.collapsedListIds = collapsedAfter;
  }
  if ((prev.insightsLists?.doing ?? null) !== (next.insightsLists?.doing ?? null)) {
    patch.doingListId = next.insightsLists?.doing ?? null;
  }
  if ((prev.insightsLists?.done ?? null) !== (next.insightsLists?.done ?? null)) {
    patch.doneListId = next.insightsLists?.done ?? null;
  }
  if (Object.keys(patch).length > 0) {
    ops.push({ kind: "updateSettings", patch });
  }
  return ops;
}

export type RequestFn = <T>(path: string, options?: ApiRequestOptions<T>) => Promise<T>;

export interface RunContext {
  boardId: string;
  // client id -> server id, for everything the client made up. Kept between runs.
  ids: Map<string, string>;
  request?: RequestFn;
}

function newestId<T extends { id: string }>(items: readonly T[], known: ReadonlySet<string>): string | undefined {
  return [...items].reverse().find((i) => !known.has(i.id))?.id;
}

// Sends the operations one after the other. Stops at the first failure and throws it.
export async function runOperations(operations: readonly Operation[], context: RunContext): Promise<void> {
  const request: RequestFn = context.request ?? apiRequest;
  const { ids } = context;
  const real = (id: string): string => ids.get(id) ?? id;
  const send = <T,>(path: string, method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", body?: unknown, schema?: ZodType<T>) =>
    request<T>(path, { method, body, schema });
  const { boardId } = context;
  const getCard = (id: string) => send(`/cards/${id}`, "GET", undefined, cardResponseSchema);

  for (const op of operations) {
    switch (op.kind) {
      case "createList": {
        const list = await send(`/boards/${boardId}/lists`, "POST", { name: op.name }, listResponseSchema);
        ids.set(op.id, list.id);
        break;
      }
      case "renameList":
        await send(`/lists/${real(op.id)}`, "PATCH", { name: op.name });
        break;
      case "moveList":
        await send(`/lists/${real(op.id)}/move`, "POST", { position: op.position });
        break;
      case "deleteList":
        await send(`/lists/${real(op.id)}`, "DELETE");
        break;
      case "setWipLimit":
        await send(`/lists/${real(op.id)}/wip-limit`, "PUT", { limit: op.limit });
        break;
      case "createCard": {
        const { card: c } = op;
        const created = await send(
          `/lists/${real(op.listId)}/cards`,
          "POST",
          {
            title: c.title,
            priority: c.priority,
            ...(c.cover !== undefined && { cover: c.cover }),
            ...(c.dueDate !== undefined && { dueDate: c.dueDate }),
            ...(c.notes !== undefined && { notes: c.notes }),
          },
          cardResponseSchema,
        );
        ids.set(op.id, created.id);
        break;
      }
      case "duplicateCard": {
        const created = await send(`/cards/${real(op.sourceId)}/duplicate`, "POST", undefined, cardResponseSchema);
        ids.set(op.id, created.id);
        break;
      }
      case "updateCard":
        await send(`/cards/${real(op.id)}`, "PATCH", op.patch);
        break;
      case "addLabel":
        await send(`/cards/${real(op.cardId)}/labels`, "POST", { name: op.name });
        break;
      case "removeLabel":
        await send(`/cards/${real(op.cardId)}/labels/${encodeURIComponent(op.name)}`, "DELETE");
        break;
      case "addChecklistItem": {
        const cardId = real(op.cardId);
        const before = await getCard(cardId);
        const known = new Set(before.checklist.map((i) => i.id));
        const after = await send(`/cards/${cardId}/checklist`, "POST", { text: op.text }, cardResponseSchema);
        const created = newestId(after.checklist, known);
        if (created) {
          ids.set(op.id, created);
        }
        break;
      }
      case "updateChecklistItem":
        await send(`/cards/${real(op.cardId)}/checklist/${real(op.id)}`, "PATCH", {
          ...(op.text !== undefined && { text: op.text }),
          ...(op.done !== undefined && { done: op.done }),
        });
        break;
      case "deleteChecklistItem":
        await send(`/cards/${real(op.cardId)}/checklist/${real(op.id)}`, "DELETE");
        break;
      case "reorderChecklist":
        await send(`/cards/${real(op.cardId)}/checklist/order`, "PUT", { itemIds: op.itemIds.map(real) });
        break;
      case "addComment": {
        const cardId = real(op.cardId);
        const before = await getCard(cardId);
        const known = new Set(before.comments.map((c) => c.id));
        const after = await send(`/cards/${cardId}/comments`, "POST", { text: op.text }, cardResponseSchema);
        const created = newestId(after.comments, known);
        if (created) {
          ids.set(op.id, created);
        }
        break;
      }
      case "editComment":
        await send(`/cards/${real(op.cardId)}/comments/${real(op.id)}`, "PATCH", { text: op.text });
        break;
      case "deleteComment":
        await send(`/cards/${real(op.cardId)}/comments/${real(op.id)}`, "DELETE");
        break;
      case "moveCard":
        await send(`/cards/${real(op.id)}/move`, "POST", { listId: real(op.listId), position: op.position });
        break;
      case "reorderCards":
        await send(`/lists/${real(op.listId)}/cards/order`, "PUT", { cardIds: op.cardIds.map(real) });
        break;
      case "archiveCard":
        await send(`/cards/${real(op.id)}/archive`, "POST");
        break;
      case "archiveList":
        await send(`/lists/${real(op.listId)}/archive`, "POST");
        break;
      case "restoreCard":
        await send(`/archive/${real(op.id)}/restore`, "POST", { listId: real(op.listId) });
        break;
      case "deleteArchived":
        await send(`/archive/${real(op.id)}`, "DELETE");
        break;
      case "emptyArchive":
        await send(`/boards/${boardId}/archive`, "DELETE");
        break;
      case "deleteCard":
        await send(`/cards/${real(op.id)}`, "DELETE");
        break;
      case "createTemplate": {
        const t = op.template;
        const created = await send(
          `/boards/${boardId}/templates`,
          "POST",
          {
            name: t.name,
            title: t.title,
            priority: t.priority,
            ...(t.notes !== undefined && { notes: t.notes }),
            labels: t.labels ?? [],
            ...(t.cover !== undefined && { cover: t.cover }),
            checklist: (t.checklist ?? []).map((i) => i.text),
          },
          templateResponseSchema,
        );
        ids.set(op.id, created.id);
        break;
      }
      case "renameTemplate":
        await send(`/templates/${real(op.id)}`, "PATCH", { name: op.name });
        break;
      case "deleteTemplate":
        await send(`/templates/${real(op.id)}`, "DELETE");
        break;
      case "updateSettings": {
        const { patch } = op;
        await send(`/boards/${boardId}/settings`, "PATCH", {
          ...patch,
          ...(patch.collapsedListIds !== undefined && { collapsedListIds: patch.collapsedListIds.map(real) }),
          ...(typeof patch.doingListId === "string" && { doingListId: real(patch.doingListId) }),
          ...(typeof patch.doneListId === "string" && { doneListId: real(patch.doneListId) }),
        });
        break;
      }
    }
  }
}
