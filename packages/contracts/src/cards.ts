import { z } from "zod";

// Limits and values mirror apps/web/src/lib/board/types.ts.
export const MAX_CARD_TITLE_LENGTH = 120;
export const MAX_NOTES_LENGTH = 1000;
export const MAX_CHECKLIST_ITEM_LENGTH = 200;
export const MAX_COMMENT_LENGTH = 1000;
export const MAX_LABEL_LENGTH = 20;
export const MAX_ACTIVITY_ENTRIES = 50;

export const activityTypes = [
  "created",
  "moved",
  "title",
  "description",
  "priority",
  "dueDate",
  "archived",
  "restored",
  "checklistDone",
  "duplicated",
] as const;

export const priorities = ["low", "medium", "high"] as const;
export const coverColors = ["red", "orange", "yellow", "green", "teal", "blue", "purple", "pink"] as const;

export const prioritySchema = z.enum(priorities);
export const coverColorSchema = z.enum(coverColors);

// Date-only `YYYY-MM-DD` that is a real calendar day (2026-02-30 is rejected).
export const dueDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const [year, month, day] = value.split("-").map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
  }, "Due date must be a valid YYYY-MM-DD date");

export const cardTitleSchema = z.string().trim().min(1).max(MAX_CARD_TITLE_LENGTH);
export const notesSchema = z.string().trim().max(MAX_NOTES_LENGTH);

export const createCardRequestSchema = z.object({
  title: cardTitleSchema,
  priority: prioritySchema.default("medium"),
  cover: coverColorSchema.optional(),
  dueDate: dueDateSchema.optional(),
  notes: notesSchema.optional(),
});

// Only the keys that are present change; `null` clears cover, dueDate and notes.
export const updateCardRequestSchema = z.object({
  title: cardTitleSchema.optional(),
  priority: prioritySchema.optional(),
  cover: coverColorSchema.nullable().optional(),
  dueDate: dueDateSchema.nullable().optional(),
  notes: notesSchema.nullable().optional(),
});

// `position` is the 0-based index in the target list; a value past the end appends.
export const moveCardRequestSchema = z.object({
  listId: z.string().min(1),
  position: z.number().int().min(0),
});

export const commentTextSchema = z.string().trim().min(1).max(MAX_COMMENT_LENGTH);
export const labelNameSchema = z.string().trim().min(1).max(MAX_LABEL_LENGTH);

export const addCommentRequestSchema = z.object({ text: commentTextSchema });
export const editCommentRequestSchema = z.object({ text: commentTextSchema });
export const addLabelRequestSchema = z.object({ name: labelNameSchema });

export const checklistItemSchema = z.object({
  id: z.string(),
  text: z.string().max(MAX_CHECKLIST_ITEM_LENGTH),
  done: z.boolean(),
  position: z.number().int(),
});

export const commentSchema = z.object({
  id: z.string(),
  text: z.string().max(MAX_COMMENT_LENGTH),
  createdAt: z.string(),
  editedAt: z.string().nullable(),
});

// `from` and `to` are list ids for `moved` and old/new values for `title`, `priority` and `dueDate`; omitted when empty.
export const activityEntrySchema = z.object({
  id: z.string(),
  at: z.string(),
  type: z.enum(activityTypes),
  from: z.string().optional(),
  to: z.string().optional(),
});

export const cardResponseSchema = z.object({
  id: z.string(),
  listId: z.string(),
  title: z.string(),
  priority: prioritySchema,
  cover: coverColorSchema.nullable(),
  dueDate: dueDateSchema.nullable(),
  notes: z.string().nullable(),
  position: z.number().int(),
  createdAt: z.string(),
  checklist: z.array(checklistItemSchema),
  comments: z.array(commentSchema),
  labels: z.array(z.string().max(MAX_LABEL_LENGTH)),
  activity: z.array(activityEntrySchema).max(MAX_ACTIVITY_ENTRIES),
});

export type Priority = z.infer<typeof prioritySchema>;
export type CoverColor = z.infer<typeof coverColorSchema>;
export type CreateCardRequest = z.infer<typeof createCardRequestSchema>;
export type UpdateCardRequest = z.infer<typeof updateCardRequestSchema>;
export type MoveCardRequest = z.infer<typeof moveCardRequestSchema>;
export type AddCommentRequest = z.infer<typeof addCommentRequestSchema>;
export type EditCommentRequest = z.infer<typeof editCommentRequestSchema>;
export type AddLabelRequest = z.infer<typeof addLabelRequestSchema>;
export type ActivityType = (typeof activityTypes)[number];
export type ChecklistItem = z.infer<typeof checklistItemSchema>;
export type Comment = z.infer<typeof commentSchema>;
export type ActivityEntry = z.infer<typeof activityEntrySchema>;
export type CardResponse = z.infer<typeof cardResponseSchema>;
