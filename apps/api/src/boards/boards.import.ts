import { randomUUID } from "node:crypto";
import {
  DEFAULT_BOARD_NAME,
  MAX_BOARD_NAME_LENGTH,
  MAX_LIST_NAME_LENGTH,
  MAX_TEMPLATE_NAME_LENGTH,
  type ParsedImportBoardRequest,
} from "@adt/contracts";
import type { Prisma } from "../generated/prisma/client.js";

type ImportedCard = ParsedImportBoardRequest["lists"][number]["cards"][number];

export interface BoardImportData {
  /** Creates the board with everything nested. The insights lists are set afterwards (they need the list rows). */
  create: Omit<Prisma.BoardUncheckedCreateInput, "userId" | "name" | "importKey">;
  doingListId: string | null;
  doneListId: string | null;
}

/** `name`, or `name (2)`, `name (3)`, ... cut to `max` characters, unique among `taken` (case-insensitively). */
export function uniqueName(name: string, taken: Set<string>, max: number): string {
  const base = name.trim().slice(0, max).trim();
  let candidate = base;
  for (let n = 2; taken.has(candidate.toLowerCase()); n++) {
    const suffix = ` (${n})`;
    candidate = `${base.slice(0, Math.max(1, max - suffix.length)).trim()}${suffix}`;
  }
  taken.add(candidate.toLowerCase());
  return candidate;
}

/** The base for the board's name: the imported one, or the default name when it is empty. */
export function importedBoardName(name: string): string {
  return name.trim().slice(0, MAX_BOARD_NAME_LENGTH).trim() || DEFAULT_BOARD_NAME;
}

function cardData(card: ImportedCard, listIds: Map<string, string>) {
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const label of card.labels) {
    if (!seen.has(label.toLowerCase())) {
      seen.add(label.toLowerCase());
      labels.push(label);
    }
  }
  const checklist = card.checklist.map((item) => ({ text: item.text.trim(), done: item.done })).filter((item) => item.text !== "");
  return {
    title: card.title,
    priority: card.priority,
    cover: card.cover ?? null,
    dueDate: card.dueDate ? new Date(`${card.dueDate}T00:00:00.000Z`) : null,
    notes: card.notes ? card.notes : null,
    ...(card.createdAt ? { createdAt: new Date(card.createdAt) } : {}),
    checklist: { create: checklist.map((item, position) => ({ ...item, position })) },
    comments: {
      create: card.comments.map((comment) => ({
        text: comment.text,
        createdAt: new Date(comment.createdAt),
        editedAt: comment.editedAt ? new Date(comment.editedAt) : null,
      })),
    },
    labels: { create: labels.map((name, position) => ({ name, position })) },
    activity: {
      create: card.activity.map((entry) => {
        // List references are client ids: map them to the new rows, and drop the ones that point nowhere.
        const mapRef = (value: string | undefined) => (entry.type === "moved" ? listIds.get(value ?? "") : value) ?? null;
        return { type: entry.type, at: new Date(entry.at), from: mapRef(entry.from) || null, to: mapRef(entry.to) || null };
      }),
    },
  };
}

/**
 * Turns a validated snapshot into the nested create data for one board. The server generates every id; client ids
 * only link things together (activity, the insights lists, former lists). References to unknown ids are dropped,
 * and list and template names are made unique, so the import never fails on a name.
 */
export function buildBoardImport(snapshot: ParsedImportBoardRequest): BoardImportData {
  const listIds = new Map<string, string>();
  for (const list of snapshot.lists) listIds.set(list.id, randomUUID());
  // Deleted lists get fresh ids too, so activity that mentions them keeps resolving to the former name.
  const formerIds = new Map<string, string>();
  for (const clientId of Object.keys(snapshot.formerLists)) {
    if (!listIds.has(clientId)) formerIds.set(clientId, randomUUID());
  }
  const refs = new Map([...formerIds, ...listIds]);

  const listNames = new Set<string>();
  const templateNames = new Set<string>();

  const lists = snapshot.lists.map((list, position) => ({
    id: listIds.get(list.id),
    name: uniqueName(list.name, listNames, MAX_LIST_NAME_LENGTH),
    position,
    wipLimit: list.wipLimit ?? null,
    collapsed: list.collapsed,
    cards: { create: list.cards.map((card, index) => ({ ...cardData(card, refs), position: index })) },
  }));

  const archivedCards = snapshot.archive.map((card) => ({
    ...cardData(card, refs),
    archivedAt: new Date(card.archivedAt),
    position: 0,
  }));

  const templates = snapshot.templates.map((template) => ({
    name: uniqueName(template.name, templateNames, MAX_TEMPLATE_NAME_LENGTH),
    title: template.title,
    priority: template.priority,
    notes: template.notes ? template.notes : null,
    labels: template.labels,
    cover: template.cover ?? null,
    checklist: template.checklist,
  }));

  const formerLists = [...formerIds].map(([clientId, listId]) => ({ listId, name: snapshot.formerLists[clientId] ?? "" }));

  const { background, view, doingListId, doneListId } = snapshot.settings;
  return {
    create: {
      backgroundColor: background?.type === "color" ? background.value : null,
      backgroundImageUrl: background?.type === "image" ? background.url : null,
      view,
      lists: { create: lists },
      archivedCards: { create: archivedCards },
      templates: { create: templates },
      formerLists: { create: formerLists },
    },
    doingListId: (doingListId && listIds.get(doingListId)) || null,
    doneListId: (doneListId && listIds.get(doneListId)) || null,
  };
}
