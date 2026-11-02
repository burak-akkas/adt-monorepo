import { z } from "zod";
import { MAX_LABEL_LENGTH, MAX_CHECKLIST_ITEM_LENGTH, cardTitleSchema, coverColorSchema, notesSchema, prioritySchema } from "./cards.js";

// Limits mirror apps/web/src/lib/templates.ts.
export const MAX_TEMPLATES = 30;
export const MAX_TEMPLATE_NAME_LENGTH = 40;

export const templateNameSchema = z.string().trim().min(1).max(MAX_TEMPLATE_NAME_LENGTH);

// A template holds no `done` flag and no due date.
export const createTemplateRequestSchema = z.object({
  name: templateNameSchema,
  title: cardTitleSchema,
  priority: prioritySchema.default("medium"),
  notes: notesSchema.optional(),
  labels: z.array(z.string().trim().min(1).max(MAX_LABEL_LENGTH)).default([]),
  cover: coverColorSchema.optional(),
  checklist: z.array(z.string().max(MAX_CHECKLIST_ITEM_LENGTH)).default([]),
});

export const renameTemplateRequestSchema = z.object({ name: templateNameSchema });

// An unknown or missing list falls back to the board's first list.
export const createCardFromTemplateRequestSchema = z.object({ listId: z.string().min(1).optional() });

export const templateResponseSchema = z.object({
  id: z.string(),
  boardId: z.string(),
  name: z.string(),
  title: z.string(),
  priority: prioritySchema,
  notes: z.string().nullable(),
  labels: z.array(z.string()),
  cover: coverColorSchema.nullable(),
  checklist: z.array(z.string()),
  createdAt: z.string(),
});

export type CreateTemplateRequest = z.infer<typeof createTemplateRequestSchema>;
export type RenameTemplateRequest = z.infer<typeof renameTemplateRequestSchema>;
export type CreateCardFromTemplateRequest = z.infer<typeof createCardFromTemplateRequestSchema>;
export type TemplateResponse = z.infer<typeof templateResponseSchema>;
