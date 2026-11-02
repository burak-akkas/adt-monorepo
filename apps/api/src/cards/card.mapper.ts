import type { CardResponse } from "@adt/contracts";
import type { Prisma } from "../generated/prisma/client.js";

export type CardRow = Prisma.CardGetPayload<object>;

export function toCard(card: CardRow): CardResponse {
  return {
    id: card.id,
    listId: card.listId,
    title: card.title,
    priority: card.priority,
    cover: card.cover,
    dueDate: card.dueDate ? card.dueDate.toISOString().slice(0, 10) : null,
    notes: card.notes,
    position: card.position,
    createdAt: card.createdAt.toISOString(),
  };
}
