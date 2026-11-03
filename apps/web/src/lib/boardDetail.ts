import type { ArchivedCard, BoardDetail, CardResponse } from "@adt/contracts";
import type { Board, Card, CardTemplate } from "./board";

type ServerCard = CardResponse | ArchivedCard;

// Optional keys are left out when empty, the way the pure board functions leave them.
function toCard(card: ServerCard): Card {
  const result: Card = { id: card.id, title: card.title, createdAt: card.createdAt, priority: card.priority };
  if (card.cover !== null) {
    result.cover = card.cover;
  }
  if (card.dueDate !== null) {
    result.dueDate = card.dueDate;
  }
  if (card.notes !== null) {
    result.notes = card.notes;
  }
  if (card.labels.length > 0) {
    result.labels = [...card.labels];
  }
  if (card.checklist.length > 0) {
    result.checklist = [...card.checklist]
      .sort((a, b) => a.position - b.position)
      .map(({ id, text, done }) => ({ id, text, done }));
  }
  if (card.comments.length > 0) {
    result.comments = card.comments.map(({ id, text, createdAt, editedAt }) => ({
      id,
      text,
      createdAt,
      ...(editedAt !== null && { editedAt }),
    }));
  }
  if (card.activity.length > 0) {
    result.activity = card.activity.map(({ id, at, type, from, to }) => ({
      id,
      at,
      type,
      ...(from !== undefined && { from }),
      ...(to !== undefined && { to }),
    }));
  }
  return result;
}

function toTemplate(template: BoardDetail["templates"][number]): CardTemplate {
  return {
    id: template.id,
    name: template.name,
    title: template.title,
    priority: template.priority,
    ...(template.notes !== null && { notes: template.notes }),
    ...(template.labels.length > 0 && { labels: [...template.labels] }),
    ...(template.cover !== null && { cover: template.cover }),
    ...(template.checklist.length > 0 && {
      checklist: template.checklist.map((text, index) => ({ id: `${template.id}:${index}`, text })),
    }),
  };
}

// The server's board as the `Board` the UI and the pure board functions work with.
export function detailToBoard(detail: BoardDetail): Board {
  const lists = [...detail.lists].sort((a, b) => a.position - b.position);
  const board: Board = {
    lists: lists.map(({ id, name }) => ({ id, name })),
    columns: Object.fromEntries(
      lists.map((list) => [list.id, [...list.cards].sort((a, b) => a.position - b.position).map(toCard)]),
    ),
    archive: detail.archive.map(toCard),
  };
  const wipLimits = Object.fromEntries(lists.flatMap((l) => (l.wipLimit === null ? [] : [[l.id, l.wipLimit] as const])));
  if (Object.keys(wipLimits).length > 0) {
    board.wipLimits = wipLimits;
  }
  const { settings } = detail;
  if (settings.background !== null) {
    board.background = settings.background;
  }
  if (settings.view !== "board") {
    board.view = settings.view;
  }
  if (settings.collapsedListIds.length > 0) {
    board.collapsedLists = [...settings.collapsedListIds];
  }
  if (Object.keys(detail.formerLists).length > 0) {
    board.formerLists = { ...detail.formerLists };
  }
  if (detail.templates.length > 0) {
    board.templates = detail.templates.map(toTemplate);
  }
  board.insightsLists = {
    ...(settings.doingListId !== null && { doing: settings.doingListId }),
    ...(settings.doneListId !== null && { done: settings.doneListId }),
  };
  if (settings.doingListId === null && settings.doneListId === null) {
    // No stored choice: insights fall back to the lists named Doing / Done, as on the server.
    delete board.insightsLists;
  }
  return board;
}
