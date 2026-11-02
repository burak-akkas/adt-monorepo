import { z } from "zod";
import { MAX_CHECKLIST_ITEM_LENGTH } from "./cards.js";

export const MAX_CHECKLIST_ITEMS_PER_REQUEST = 500;

export const checklistTextSchema = z.string().trim().min(1).max(MAX_CHECKLIST_ITEM_LENGTH);

export const addChecklistItemRequestSchema = z.object({ text: checklistTextSchema });

export const updateChecklistItemRequestSchema = z
  .object({ text: checklistTextSchema.optional(), done: z.boolean().optional() })
  .refine((body) => body.text !== undefined || body.done !== undefined, {
    message: "Provide text or done",
  });

export const reorderChecklistRequestSchema = z.object({
  itemIds: z.array(z.string().min(1)).max(MAX_CHECKLIST_ITEMS_PER_REQUEST),
});

export type AddChecklistItemRequest = z.infer<typeof addChecklistItemRequestSchema>;
export type UpdateChecklistItemRequest = z.infer<typeof updateChecklistItemRequestSchema>;
export type ReorderChecklistRequest = z.infer<typeof reorderChecklistRequestSchema>;
