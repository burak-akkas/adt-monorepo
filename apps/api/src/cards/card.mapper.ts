import { MAX_ACTIVITY_ENTRIES, activityTypes, type ArchivedCard, type CardResponse } from "@adt/contracts";
import type { Prisma } from "../generated/prisma/client.js";

/** What every read of a card loads, so the response can carry its details without extra queries. */
export const cardDetails = {
  checklist: { orderBy: { position: "asc" } },
  comments: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
  labels: { orderBy: { position: "asc" } },
  activity: { orderBy: [{ at: "desc" }, { id: "desc" }], take: MAX_ACTIVITY_ENTRIES },
} satisfies Prisma.CardInclude;

export type CardWithDetails = Prisma.CardGetPayload<{ include: typeof cardDetails }>;

const knownActivityTypes: readonly string[] = activityTypes;

/** The parts of a card shared by live and archived cards. */
function toCardContent(card: CardWithDetails) {
  return {
    id: card.id,
    title: card.title,
    priority: card.priority,
    cover: card.cover,
    dueDate: card.dueDate ? card.dueDate.toISOString().slice(0, 10) : null,
    notes: card.notes,
    createdAt: card.createdAt.toISOString(),
    checklist: card.checklist.map((item) => ({ id: item.id, text: item.text, done: item.done, position: item.position })),
    comments: card.comments.map((comment) => ({
      id: comment.id,
      text: comment.text,
      createdAt: comment.createdAt.toISOString(),
      editedAt: comment.editedAt ? comment.editedAt.toISOString() : null,
    })),
    labels: card.labels.map((label) => label.name),
    activity: card.activity
      .filter((entry): entry is typeof entry & { type: CardResponse["activity"][number]["type"] } => knownActivityTypes.includes(entry.type))
      .map((entry) => ({
        id: entry.id,
        at: entry.at.toISOString(),
        type: entry.type,
        ...(entry.from ? { from: entry.from } : {}),
        ...(entry.to ? { to: entry.to } : {}),
      })),
  };
}

/** A live card. Archived cards (no list) never reach here: they are mapped with `toArchivedCard`. */
export function toCard(card: CardWithDetails): CardResponse {
  if (card.listId === null) {
    throw new Error(`Card ${card.id} has no list`);
  }
  return { ...toCardContent(card), listId: card.listId, position: card.position };
}

export function toArchivedCard(card: CardWithDetails): ArchivedCard {
  if (card.boardId === null || card.archivedAt === null) {
    throw new Error(`Card ${card.id} is not archived`);
  }
  return { ...toCardContent(card), boardId: card.boardId, archivedAt: card.archivedAt.toISOString() };
}
