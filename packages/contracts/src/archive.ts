import { z } from "zod";
import { cardResponseSchema } from "./cards.js";

// An archived card has no list or position; it belongs to the board it was archived from.
export const archivedCardSchema = cardResponseSchema.omit({ listId: true, position: true }).extend({
  boardId: z.string(),
  archivedAt: z.string(),
});

// Without a listId the card goes to the board's done list, else its last list.
export const restoreCardRequestSchema = z.object({ listId: z.string().min(1).optional() });

export type ArchivedCard = z.infer<typeof archivedCardSchema>;
export type RestoreCardRequest = z.infer<typeof restoreCardRequestSchema>;
