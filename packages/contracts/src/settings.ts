import { z } from "zod";

export const MIN_WIP_LIMIT = 1;
export const MAX_WIP_LIMIT = 99;
export const MAX_BACKGROUND_URL_LENGTH = 2048;

export const boardViewSchema = z.enum(["board", "calendar", "table"]);

function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

export const backgroundSchema = z
  .discriminatedUnion("type", [
    z.object({ type: z.literal("color"), value: z.string().regex(/^#[0-9a-f]{6}$/i) }),
    z.object({
      type: z.literal("image"),
      url: z.string().max(MAX_BACKGROUND_URL_LENGTH).refine(isHttpUrl, "Must be an http(s) URL"),
    }),
  ])
  .nullable();

const listIdsSchema = z.array(z.string().min(1));

export const boardSettingsSchema = z.object({
  background: backgroundSchema,
  view: boardViewSchema,
  collapsedListIds: listIdsSchema,
  // The chosen lists. Without a choice, the list named Doing / Done is used (see the API's insights-lists helper).
  doingListId: z.string().nullable(),
  doneListId: z.string().nullable(),
});

// Every key is optional: only the keys present change, `null` clears.
export const updateBoardSettingsRequestSchema = z
  .object({
    background: backgroundSchema,
    view: boardViewSchema,
    collapsedListIds: listIdsSchema,
    doingListId: z.string().min(1).nullable(),
    doneListId: z.string().min(1).nullable(),
  })
  .partial()
  .strict();

// `limit: null` removes the limit.
export const wipLimitRequestSchema = z.object({
  limit: z.number().int().min(MIN_WIP_LIMIT).max(MAX_WIP_LIMIT).nullable(),
});

export type BoardView = z.infer<typeof boardViewSchema>;
export type Background = z.infer<typeof backgroundSchema>;
export type BoardSettings = z.infer<typeof boardSettingsSchema>;
export type UpdateBoardSettingsRequest = z.infer<typeof updateBoardSettingsRequestSchema>;
export type WipLimitRequest = z.infer<typeof wipLimitRequestSchema>;
