import { z } from "zod";
import { listWithCardsSchema } from "./lists.js";
import { boardSettingsSchema } from "./settings.js";

export const MAX_BOARD_NAME_LENGTH = 40;
export const DEFAULT_BOARD_NAME = "My board";
export const DEFAULT_LIST_NAMES = ["To do", "Doing", "Done"] as const;

export const boardNameSchema = z.string().trim().min(1).max(MAX_BOARD_NAME_LENGTH);

export const createBoardRequestSchema = z.object({ name: boardNameSchema });
export const renameBoardRequestSchema = z.object({ name: boardNameSchema });

export const boardSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const boardDetailSchema = boardSummarySchema.extend({
  lists: z.array(listWithCardsSchema),
  settings: boardSettingsSchema,
  // Last names of deleted lists, by list id.
  formerLists: z.record(z.string(), z.string()),
});

export type CreateBoardRequest = z.infer<typeof createBoardRequestSchema>;
export type RenameBoardRequest = z.infer<typeof renameBoardRequestSchema>;
export type BoardSummary = z.infer<typeof boardSummarySchema>;
export type BoardDetail = z.infer<typeof boardDetailSchema>;
