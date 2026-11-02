import type { Card } from "@/lib/board";

// Plain-text version of a card for sharing: title, due date, notes, then the checklist.
// Empty parts are left out; the remaining parts are separated by a blank line.
export function cardToText(card: Card): string {
  const parts: string[] = [card.title];
  if (card.dueDate) {
    parts.push(`Due: ${card.dueDate}`);
  }
  if (card.notes) {
    parts.push(card.notes);
  }
  if (card.checklist && card.checklist.length > 0) {
    parts.push(card.checklist.map((item) => `${item.done ? "[x]" : "[ ]"} ${item.text}`).join("\n"));
  }
  return parts.join("\n\n");
}
