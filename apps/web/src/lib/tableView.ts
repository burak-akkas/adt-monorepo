// Pure logic for the table view: rows for all open cards, sorting and filtering.
import { boardLists, checklistProgress, listCards, listName, type Board, type Card, type ColumnId } from "./board";

export interface TableRow {
  card: Card;
  listId: ColumnId;
  listName: string;
  // Position of the list on the board, for sorting by list.
  listIndex: number;
}

export type SortKey = "title" | "list" | "priority" | "dueDate" | "labels" | "checklist" | "activity";

export type SortDir = "asc" | "desc";

export const SORT_COLUMNS: readonly { key: SortKey; label: string }[] = [
  { key: "title", label: "Title" },
  { key: "list", label: "List" },
  { key: "priority", label: "Priority" },
  { key: "dueDate", label: "Due date" },
  { key: "labels", label: "Labels" },
  { key: "checklist", label: "Checklist" },
  { key: "activity", label: "Last activity" },
];

export interface RowFilter {
  listId?: ColumnId;
  label?: string;
}

// ISO timestamp of the newest activity entry, else the creation time.
export function lastActivityAt(card: Card): string {
  return card.activity?.[0]?.at ?? card.createdAt;
}

// All open (non-archived) cards in list order.
export function tableRows(board: Board): TableRow[] {
  return boardLists(board).flatMap((list, listIndex) =>
    listCards(board, list.id).map((card) => ({ card, listId: list.id, listName: listName(board, list.id), listIndex })),
  );
}

const PRIORITY_RANK = { low: 0, medium: 1, high: 2 } as const;

const text = (a: string, b: string) => a.toLowerCase().localeCompare(b.toLowerCase());

// Ratio of done checklist items, or undefined without a checklist.
function ratio(card: Card): number | undefined {
  const progress = checklistProgress(card);
  return progress && progress.done / progress.total;
}

// Compares two values ascending. Missing values go last whatever the direction, so `dir` is applied here.
function compareOptional<T>(a: T | undefined, b: T | undefined, dir: SortDir, compare: (x: T, y: T) => number): number {
  if (a === undefined || b === undefined) {
    return a === b ? 0 : a === undefined ? 1 : -1;
  }
  return dir === "asc" ? compare(a, b) : -compare(a, b);
}

// A stable sort that does not mutate its input. Ties keep their incoming order.
export function sortRows(rows: readonly TableRow[], key: SortKey, dir: SortDir): TableRow[] {
  const sign = dir === "asc" ? 1 : -1;
  const compare = (a: TableRow, b: TableRow): number => {
    switch (key) {
      case "title":
        return sign * text(a.card.title, b.card.title);
      case "list":
        return sign * (a.listIndex - b.listIndex);
      case "priority":
        return sign * (PRIORITY_RANK[a.card.priority] - PRIORITY_RANK[b.card.priority]);
      case "dueDate":
        return compareOptional(a.card.dueDate, b.card.dueDate, dir, (x, y) => (x < y ? -1 : x > y ? 1 : 0));
      case "labels":
        return compareOptional(a.card.labels?.[0], b.card.labels?.[0], dir, text);
      case "checklist":
        return compareOptional(ratio(a.card), ratio(b.card), dir, (x, y) => x - y);
      case "activity": {
        const x = new Date(lastActivityAt(a.card)).getTime();
        const y = new Date(lastActivityAt(b.card)).getTime();
        return sign * (x - y);
      }
    }
  };
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => compare(a.row, b.row) || a.index - b.index)
    .map(({ row }) => row);
}

// Rows in the given list and/or having the label (case-insensitive).
export function filterRows(rows: readonly TableRow[], { listId, label }: RowFilter): TableRow[] {
  const wanted = label?.toLowerCase();
  return rows.filter(
    (row) =>
      (listId === undefined || row.listId === listId) &&
      (wanted === undefined || (row.card.labels ?? []).some((l) => l.toLowerCase() === wanted)),
  );
}
