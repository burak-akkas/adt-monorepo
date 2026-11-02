import { z } from "zod";
import { boardDetailSchema } from "./boards.js";
import {
  MAX_ACTIVITY_ENTRIES,
  MAX_CHECKLIST_ITEM_LENGTH,
  MAX_COMMENT_LENGTH,
  MAX_LABEL_LENGTH,
  activityTypes,
  cardTitleSchema,
  coverColorSchema,
  dueDateSchema,
  notesSchema,
  prioritySchema,
} from "./cards.js";
import { MAX_LIST_NAME_LENGTH } from "./lists.js";
import { MAX_WIP_LIMIT, MIN_WIP_LIMIT, backgroundSchema, boardViewSchema } from "./settings.js";
import { MAX_TEMPLATES, createTemplateRequestSchema } from "./templates.js";

// Upper bounds for one import. The API's request body size limit applies as well.
export const MAX_IMPORT_LISTS = 50;
export const MAX_IMPORT_CARDS = 2000;
export const MAX_IMPORT_ITEMS_PER_CARD = 200;

const timestampSchema = z.iso.datetime({ offset: true });
const clientIdSchema = z.string().min(1).max(100);

const importActivitySchema = z.object({
  type: z.enum(activityTypes),
  at: timestampSchema,
  // List ids (client ids) for `moved`; old and new values otherwise.
  from: z.string().max(200).optional(),
  to: z.string().max(200).optional(),
});

const importCardContentSchema = z.object({
  title: cardTitleSchema,
  priority: prioritySchema.default("medium"),
  cover: coverColorSchema.optional(),
  dueDate: dueDateSchema.optional(),
  notes: notesSchema.optional(),
  createdAt: timestampSchema.optional(),
  checklist: z
    .array(z.object({ text: z.string().max(MAX_CHECKLIST_ITEM_LENGTH), done: z.boolean().default(false) }))
    .max(MAX_IMPORT_ITEMS_PER_CARD)
    .default([]),
  comments: z
    .array(
      z.object({
        text: z.string().trim().min(1).max(MAX_COMMENT_LENGTH),
        createdAt: timestampSchema,
        editedAt: timestampSchema.optional(),
      }),
    )
    .max(MAX_IMPORT_ITEMS_PER_CARD)
    .default([]),
  labels: z.array(z.string().trim().min(1).max(MAX_LABEL_LENGTH)).max(MAX_IMPORT_ITEMS_PER_CARD).default([]),
  activity: z.array(importActivitySchema).max(MAX_ACTIVITY_ENTRIES).default([]),
});

export const importListSchema = z.object({
  id: clientIdSchema,
  name: z.string().trim().min(1).max(MAX_LIST_NAME_LENGTH),
  wipLimit: z.number().int().min(MIN_WIP_LIMIT).max(MAX_WIP_LIMIT).optional(),
  collapsed: z.boolean().default(false),
  cards: z.array(importCardContentSchema).max(MAX_IMPORT_CARDS).default([]),
});

export const importArchivedCardSchema = importCardContentSchema.extend({ archivedAt: timestampSchema });

export const importBoardRequestSchema = z
  .object({
    // Chosen by the client once per import, so a retry of the same import is recognised.
    importKey: z.uuid(),
    name: z.string().trim().max(200),
    lists: z.array(importListSchema).max(MAX_IMPORT_LISTS),
    archive: z.array(importArchivedCardSchema).max(MAX_IMPORT_CARDS).default([]),
    templates: z.array(createTemplateRequestSchema).max(MAX_TEMPLATES).default([]),
    // Last names of deleted lists, by client list id.
    formerLists: z.record(z.string().max(100), z.string().max(MAX_LIST_NAME_LENGTH * 4)).default({}),
    settings: z
      .object({
        background: backgroundSchema.default(null),
        view: boardViewSchema.default("board"),
        // Client list ids. Unknown ids are dropped.
        doingListId: z.string().nullable().default(null),
        doneListId: z.string().nullable().default(null),
      })
      .default({ background: null, view: "board", doingListId: null, doneListId: null }),
  })
  .superRefine((snapshot, ctx) => {
    const cards = snapshot.lists.reduce((sum, list) => sum + list.cards.length, 0) + snapshot.archive.length;
    if (cards > MAX_IMPORT_CARDS) {
      ctx.addIssue({ code: "custom", message: `At most ${MAX_IMPORT_CARDS} cards can be imported at once` });
    }
    const ids = new Set(snapshot.lists.map((list) => list.id));
    if (ids.size !== snapshot.lists.length) {
      ctx.addIssue({ code: "custom", path: ["lists"], message: "List ids must be unique" });
    }
  });

export const importBoardResponseSchema = z.object({
  board: boardDetailSchema,
  // false when the importKey had been used already and the existing board is returned.
  created: z.boolean(),
});

export type ImportBoardRequest = z.input<typeof importBoardRequestSchema>;
export type ParsedImportBoardRequest = z.infer<typeof importBoardRequestSchema>;
export type ImportBoardResponse = z.infer<typeof importBoardResponseSchema>;
