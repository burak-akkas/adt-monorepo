import { boardLists, listCards, type Board } from "@/lib/board";

// Markdown summary of a board, for sharing. Archived cards are not included.
//
//   # Board name
//
//   ## List name
//   - Title (due 2026-11-05)
//   - Other title
//
//   ## Empty list
//   _No cards_
//
// The due date is the stored YYYY-MM-DD string, added only when set. Lists are separated by a blank
// line and the text ends with one newline. Newlines in titles become spaces so each card is one bullet.
export function boardToMarkdown(board: Board, name: string): string {
  const oneLine = (text: string) => text.replace(/\s*[\r\n]+\s*/g, " ").trim();
  const sections = boardLists(board).map((list) => {
    const cards = listCards(board, list.id);
    const lines =
      cards.length === 0
        ? ["_No cards_"]
        : cards.map((card) => `- ${oneLine(card.title)}${card.dueDate ? ` (due ${card.dueDate})` : ""}`);
    return [`## ${oneLine(list.name)}`, ...lines].join("\n");
  });
  return [`# ${oneLine(name)}`, ...sections].join("\n\n") + "\n";
}
