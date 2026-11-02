import { z } from "zod";
import { cardResponseSchema } from "./cards.js";

export const MAX_LIST_NAME_LENGTH = 30;

export const listNameSchema = z.string().trim().min(1).max(MAX_LIST_NAME_LENGTH);

export const createListRequestSchema = z.object({ name: listNameSchema });
export const renameListRequestSchema = z.object({ name: listNameSchema });

// `moveTo` is the list (on the same board) that receives the deleted list's cards.
export const deleteListQuerySchema = z.object({ moveTo: z.string().min(1).optional() });

export const moveListRequestSchema = z.object({ position: z.number().int().min(0) });

export const listResponseSchema = z.object({
  id: z.string(),
  boardId: z.string(),
  name: z.string(),
  position: z.number().int(),
  wipLimit: z.number().int().nullable(),
  collapsed: z.boolean(),
});

export const listWithCardsSchema = listResponseSchema.extend({ cards: z.array(cardResponseSchema) });

export type CreateListRequest = z.infer<typeof createListRequestSchema>;
export type RenameListRequest = z.infer<typeof renameListRequestSchema>;
export type DeleteListQuery = z.infer<typeof deleteListQuerySchema>;
export type MoveListRequest = z.infer<typeof moveListRequestSchema>;
export type ListResponse = z.infer<typeof listResponseSchema>;
export type ListWithCards = z.infer<typeof listWithCardsSchema>;
