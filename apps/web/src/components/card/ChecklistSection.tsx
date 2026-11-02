"use client";

import { useId, useState } from "react";
import {
  addChecklistItem,
  checklistProgress,
  deleteChecklistItem,
  deleteCompletedChecklistItems,
  editChecklistItem,
  hasCompletedItemsAboveOpen,
  MAX_CHECKLIST_ITEM_LENGTH,
  moveChecklistItem,
  moveCompletedChecklistItemsToBottom,
  normalizeChecklistText,
  toggleChecklistItem,
  uncheckAllChecklistItems,
  type Board,
  type Card,
} from "@/lib/board";

import { Button, Input } from "@/components/ui";

// Actions apply immediately (they are not part of the dialog's Save/Cancel draft).
export function ChecklistSection({
  card,
  onChange,
}: {
  card: Card;
  onChange: (change: (board: Board) => Board) => void;
}) {
  const baseId = useId();
  const items = card.checklist ?? [];
  const progress = checklistProgress(card);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [editError, setEditError] = useState<string | null>(null);

  // Validates the text first so the lib's message is shown instead of throwing inside the board update.
  function run(text: string, change: (board: Board) => Board, fail: (message: string) => void): boolean {
    try {
      normalizeChecklistText(text);
    } catch (e) {
      fail(e instanceof Error ? e.message : "Invalid checklist item");
      return false;
    }
    onChange(change);
    return true;
  }

  function add() {
    if (run(input, (b) => addChecklistItem(b, card.id, input), setError)) {
      setInput("");
      setError(null);
    }
  }

  function startEditing(id: string, text: string) {
    setEditingId(id);
    setDraft(text);
    setEditError(null);
  }

  function saveEdit(id: string) {
    if (run(draft, (b) => editChecklistItem(b, card.id, id, draft), setEditError)) {
      setEditingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-baseline gap-2 text-xs font-medium text-subtle">
          Checklist
          {progress && (
            <span className="text-muted">
              {progress.done}/{progress.total} done
            </span>
          )}
        </h3>
        <div className="flex flex-wrap items-center justify-end gap-1">
          <Button
            size="xs"
            variant="ghost"
            disabled={!hasCompletedItemsAboveOpen(items)}
            onClick={() => onChange((b) => moveCompletedChecklistItemsToBottom(b, card.id))}
          >
            Move completed to bottom
          </Button>
          <Button
            size="xs"
            variant="ghost"
            disabled={!progress || progress.done === 0}
            onClick={() => onChange((b) => uncheckAllChecklistItems(b, card.id))}
          >
            Uncheck all
          </Button>
          <Button
            size="xs"
            variant="ghost"
            disabled={!progress || progress.done === 0}
            onClick={() => onChange((b) => deleteCompletedChecklistItems(b, card.id))}
          >
            Delete completed
          </Button>
        </div>
      </div>
      {items.length > 0 && (
        <ul aria-label="Checklist items" className="flex flex-col gap-1">
          {items.map((item, index) => (
            <li key={item.id} className="flex flex-wrap items-center gap-2">
              {editingId === item.id ? (
                <>
                  <Input
                    aria-label={`Edit checklist item "${item.text}"`}
                    value={draft}
                    maxLength={MAX_CHECKLIST_ITEM_LENGTH}
                    aria-invalid={editError !== null}
                    onChange={(event) => {
                      setDraft(event.target.value);
                      setEditError(null);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        saveEdit(item.id);
                      } else if (event.key === "Escape") {
                        // Don't let Escape reach the dialog's close handler.
                        event.preventDefault();
                        event.stopPropagation();
                        setEditingId(null);
                      }
                    }}
                    autoFocus
                    className="min-w-0 flex-1"
                  />
                  <Button size="xs" variant="primary" onClick={() => saveEdit(item.id)}>
                    Save item
                  </Button>
                  <Button size="xs" variant="ghost" onClick={() => setEditingId(null)}>
                    Cancel edit
                  </Button>
                  {editError && (
                    <p role="alert" className="w-full text-xs text-danger">
                      {editError}
                    </p>
                  )}
                </>
              ) : (
                <>
                  <label className="flex min-w-0 flex-1 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={item.done}
                      onChange={() => onChange((b) => toggleChecklistItem(b, card.id, item.id))}
                      className="size-4 shrink-0 accent-accent"
                    />
                    <span className={`break-words ${item.done ? "text-muted line-through" : ""}`}>{item.text}</span>
                  </label>
                  <div className="flex flex-wrap items-center gap-1">
                    <Button
                      size="xs"
                      variant="ghost"
                      aria-label={`Move up "${item.text}"`}
                      disabled={index === 0}
                      onClick={() => onChange((b) => moveChecklistItem(b, card.id, item.id, -1))}
                    >
                      ↑
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      aria-label={`Move down "${item.text}"`}
                      disabled={index === items.length - 1}
                      onClick={() => onChange((b) => moveChecklistItem(b, card.id, item.id, 1))}
                    >
                      ↓
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      aria-label={`Edit checklist item "${item.text}"`}
                      onClick={() => startEditing(item.id, item.text)}
                    >
                      Edit
                    </Button>
                    <Button
                      size="xs"
                      variant="danger"
                      aria-label={`Delete checklist item "${item.text}"`}
                      onClick={() => onChange((b) => deleteChecklistItem(b, card.id, item.id))}
                    >
                      Delete
                    </Button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="New checklist item"
          value={input}
          maxLength={MAX_CHECKLIST_ITEM_LENGTH}
          aria-invalid={error !== null}
          aria-describedby={error ? `${baseId}-error` : undefined}
          onChange={(event) => {
            setInput(event.target.value);
            setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
          className="min-w-0 flex-1"
        />
        <Button size="sm" onClick={add}>
          Add item
        </Button>
        <span className="text-xs text-muted" aria-hidden="true">
          {input.length}/{MAX_CHECKLIST_ITEM_LENGTH}
        </span>
      </div>
      {error && (
        <p id={`${baseId}-error`} role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
