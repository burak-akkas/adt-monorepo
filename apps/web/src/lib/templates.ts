// Pure card-template logic. Every function returns a new board and never mutates its input.
import {
  boardLists,
  findCard,
  listCards,
  withActivity,
  type Board,
  type Card,
  type CardTemplate,
  type ColumnId,
} from "./board";

export const MAX_TEMPLATES = 30;

export const MAX_TEMPLATE_NAME_LENGTH = 40;

export function boardTemplates(board: Board): readonly CardTemplate[] {
  return board.templates ?? [];
}

export type TemplateNameResult = { ok: true; name: string } | { ok: false; error: string };

// `ignoreId` is the template being renamed, so it may keep its own name (e.g. with different casing).
export function validateTemplateName(name: string, templates: readonly CardTemplate[], ignoreId?: string): TemplateNameResult {
  const trimmed = name.trim();
  if (!trimmed) {
    return { ok: false, error: "Template name must not be empty." };
  }
  if (trimmed.length > MAX_TEMPLATE_NAME_LENGTH) {
    return { ok: false, error: `Template name must be at most ${MAX_TEMPLATE_NAME_LENGTH} characters.` };
  }
  const lower = trimmed.toLowerCase();
  if (templates.some((t) => t.id !== ignoreId && t.name.toLowerCase() === lower)) {
    return { ok: false, error: "A template with this name already exists." };
  }
  return { ok: true, name: trimmed };
}

// The base name cut to the maximum length, with " (2)", " (3)" … added until it is unique.
function uniqueName(base: string, templates: readonly CardTemplate[]): string {
  const taken = new Set(templates.map((t) => t.name.toLowerCase()));
  const cut = base.trim().slice(0, MAX_TEMPLATE_NAME_LENGTH).trim() || "Template";
  if (!taken.has(cut.toLowerCase())) {
    return cut;
  }
  for (let n = 2; ; n++) {
    const suffix = ` (${n})`;
    const candidate = cut.slice(0, MAX_TEMPLATE_NAME_LENGTH - suffix.length).trimEnd() + suffix;
    if (!taken.has(candidate.toLowerCase())) {
      return candidate;
    }
  }
}

// Stores a template made from a card: title, notes, labels, priority, cover and checklist text (fresh ids).
// Due date, comments and activity are not copied. Without `name` the card title is used. Throws on a missing card,
// an invalid or taken name, or when MAX_TEMPLATES is reached.
export function saveAsTemplate(
  board: Board,
  cardId: string,
  name?: string,
  { id = crypto.randomUUID() }: { id?: string } = {},
): Board {
  const found = findCard(board, cardId);
  if (!found) {
    throw new Error(`Card ${cardId} not found`);
  }
  const templates = boardTemplates(board);
  if (templates.length >= MAX_TEMPLATES) {
    throw new Error(`A board can have at most ${MAX_TEMPLATES} templates.`);
  }
  if (templates.some((t) => t.id === id)) {
    throw new Error(`Template ${id} already exists`);
  }
  let finalName: string;
  if (name === undefined) {
    finalName = uniqueName(found.card.title, templates);
  } else {
    const result = validateTemplateName(name, templates);
    if (!result.ok) {
      throw new Error(result.error);
    }
    finalName = result.name;
  }
  const { card } = found;
  const template: CardTemplate = { id, name: finalName, title: card.title, priority: card.priority };
  if (card.notes !== undefined) {
    template.notes = card.notes;
  }
  if (card.labels && card.labels.length > 0) {
    template.labels = [...card.labels];
  }
  if (card.cover !== undefined) {
    template.cover = card.cover;
  }
  if (card.checklist && card.checklist.length > 0) {
    template.checklist = card.checklist.map((item) => ({ id: crypto.randomUUID(), text: item.text }));
  }
  return { ...board, templates: [...templates, template] };
}

function requireTemplate(board: Board, id: string): CardTemplate {
  const template = boardTemplates(board).find((t) => t.id === id);
  if (!template) {
    throw new Error(`Template ${id} not found`);
  }
  return template;
}

// Throws on an unknown template or invalid name. Renaming to the same name returns the same board.
export function renameTemplate(board: Board, id: string, name: string): Board {
  const template = requireTemplate(board, id);
  const result = validateTemplateName(name, boardTemplates(board), id);
  if (!result.ok) {
    throw new Error(result.error);
  }
  if (template.name === result.name) {
    return board;
  }
  return { ...board, templates: boardTemplates(board).map((t) => (t.id === id ? { ...t, name: result.name } : t)) };
}

// Removes the template; the key is dropped when none is left. Throws on an unknown template.
export function deleteTemplate(board: Board, id: string): Board {
  requireTemplate(board, id);
  const templates = boardTemplates(board).filter((t) => t.id !== id);
  const next: Board = { ...board, templates };
  if (templates.length === 0) {
    delete next.templates;
  }
  return next;
}

// Appends a new card built from the template to the list `listId`; an unknown or missing list falls back to the
// first list. The checklist is unticked with fresh ids; there is no due date, comment or copied activity.
export function addCardFromTemplate(
  board: Board,
  templateId: string,
  listId?: ColumnId,
  { id = crypto.randomUUID(), now = new Date() }: { id?: string; now?: Date } = {},
): Board {
  const template = requireTemplate(board, templateId);
  const lists = boardLists(board);
  const target = lists.find((l) => l.id === listId)?.id ?? lists[0].id;
  let card: Card = { id, title: template.title, createdAt: now.toISOString(), priority: template.priority };
  if (template.notes !== undefined) {
    card.notes = template.notes;
  }
  if (template.labels && template.labels.length > 0) {
    card.labels = [...template.labels];
  }
  if (template.cover !== undefined) {
    card.cover = template.cover;
  }
  if (template.checklist && template.checklist.length > 0) {
    card.checklist = template.checklist.map((item) => ({ id: crypto.randomUUID(), text: item.text, done: false }));
  }
  card = withActivity(card, { type: "created" }, { now });
  return { ...board, columns: { ...board.columns, [target]: [...listCards(board, target), card] } };
}
