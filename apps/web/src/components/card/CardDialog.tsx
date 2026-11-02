"use client";

import { useCallback, useId, useState, type FormEvent } from "react";
import { CopyLinkToast, type CopyResult } from "@/components/app/CopyLinkToast";
import {
  addComment,
  addDays,
  addLabelToList,
  boardLists,
  COVER_COLORS,
  DEFAULT_LISTS,
  deleteComment,
  editComment,
  hasChanges,
  isValidDueDate,
  MAX_NOTES_LENGTH,
  MAX_TITLE_LENGTH,
  PRIORITIES,
  relativeDueHint,
  removeLabelFromList,
  todayString,
  type Board,
  type Card,
  type CardEdits,
  type ColumnId,
  type CoverColor,
  type Priority,
} from "@/lib/board";
import { coverStyles } from "./coverColors";

import { ActivityLog } from "./ActivityLog";
import { CardComments } from "./CardComments";
import { ChecklistSection } from "./ChecklistSection";
import { LabelChip } from "./LabelChip";
import { Button, ConfirmDialog, Dialog, Input, Select, Textarea } from "@/components/ui";

const labelStyles = "text-xs font-medium text-subtle";

const QUICK_DUE_DATES = [
  { label: "Today", days: 0 },
  { label: "Tomorrow", days: 1 },
  { label: "Next week", days: 7 },
];

export function CardDialog({
  card,
  column,
  onSave,
  onDelete,
  onDuplicate,
  onCopyText,
  onArchive,
  onSaveTemplate,
  onMoveToTop,
  onMoveToBottom,
  canMoveToTop = true,
  canMoveToBottom = true,
  onClose,
  onChecklist,
  onUpdateBoard,
  board,
}: {
  card: Card;
  column: ColumnId;
  // The board the card is on, for its lists. Without it the default three lists are offered.
  board?: Board;
  onChecklist?: (change: (board: Board) => Board) => void;
  onSave: (edits: CardEdits) => void;
  onDelete: () => void;
  // Duplicates the saved card (unsaved edits in this dialog are not copied).
  onDuplicate?: () => void;
  // Copies the saved card as plain text (unsaved edits in this dialog are not copied).
  // Resolves to "copied", or to the text when the clipboard is unavailable.
  onCopyText?: () => Promise<CopyResult>;
  // Archives the saved card (unsaved edits in this dialog are not saved).
  onArchive?: () => void;
  // Saves the saved card as a template of the board and reports the outcome (shown in the dialog).
  onSaveTemplate?: () => { ok: boolean; message: string };
  // Reorder the card within its list; the dialog stays open and unsaved edits are neither lost nor saved.
  onMoveToTop?: () => void;
  onMoveToBottom?: () => void;
  canMoveToTop?: boolean;
  canMoveToBottom?: boolean;
  onClose: () => void;
  onUpdateBoard: (fn: (board: Board) => Board) => void;
}) {
  const headingId = useId();
  const [title, setTitle] = useState(card.title);
  const [notes, setNotes] = useState(card.notes ?? "");
  const [priority, setPriority] = useState<Priority>(card.priority);
  const [dueDate, setDueDate] = useState(card.dueDate ?? "");
  const [status, setStatus] = useState<ColumnId>(column);
  const [labels, setLabels] = useState<string[]>(card.labels ?? []);
  const [cover, setCover] = useState<CoverColor | undefined>(card.cover);
  const [labelInput, setLabelInput] = useState("");
  const [labelError, setLabelError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<"discard" | "delete" | null>(null);
  const [templateResult, setTemplateResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [copyResult, setCopyResult] = useState<CopyResult | null>(null);
  const [copyKind, setCopyKind] = useState<"card" | "comment">("card");
  const dismissCopy = useCallback(() => setCopyResult(null), []);

  async function copyComment(text: string) {
    let result: CopyResult;
    try {
      await navigator.clipboard.writeText(text);
      result = "copied";
    } catch {
      result = { text };
    }
    setCopyKind("comment");
    setCopyResult(result);
  }

  function addLabel() {
    try {
      setLabels(addLabelToList(labels, labelInput));
      setLabelInput("");
      setLabelError(null);
    } catch (error) {
      setLabelError(error instanceof Error ? error.message : "Invalid label");
    }
  }

  const titleInvalid = !title.trim();
  const dueDateInvalid = dueDate !== "" && !isValidDueDate(dueDate);
  const invalid = titleInvalid || dueDateInvalid;

  const edits: CardEdits = {
    title,
    notes: notes.trim() || undefined,
    priority,
    dueDate: dueDate || undefined,
    column: status,
    labels,
    cover,
  };

  // Closing with unsaved changes needs confirmation.
  function requestClose() {
    if (hasChanges(card, column, edits)) {
      setConfirming("discard");
      return;
    }
    onClose();
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (invalid) {
      return;
    }
    onSave(edits);
  }


  return (
    // Escape and backdrop clicks go through requestClose so unsaved changes can be confirmed first.
    <Dialog labelledBy={headingId} onRequestClose={requestClose} size="lg">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4 p-5">
        <h2 id={headingId} className="break-words text-lg font-semibold">
          {card.title}
        </h2>

        <div className="flex flex-col gap-1">
          <label htmlFor={`${headingId}-title`} className={labelStyles}>
            Title
          </label>
          <Input
            id={`${headingId}-title`}
            value={title}
            maxLength={MAX_TITLE_LENGTH}
            aria-invalid={titleInvalid}
            aria-describedby={titleInvalid ? `${headingId}-title-error` : undefined}
            onChange={(event) => setTitle(event.target.value)}
            className="w-full"
          />
          {titleInvalid && (
            <p id={`${headingId}-title-error`} role="alert" className="text-xs text-danger">
              Title must not be empty
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor={`${headingId}-description`} className={labelStyles}>
            Description
          </label>
          <Textarea
            id={`${headingId}-description`}
            value={notes}
            maxLength={MAX_NOTES_LENGTH}
            rows={5}
            aria-describedby={`${headingId}-description-count`}
            onChange={(event) => setNotes(event.target.value)}
            className="w-full"
          />
          <p id={`${headingId}-description-count`} className="self-end text-xs text-muted">
            {notes.length} {notes.length === 1 ? "character" : "characters"}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor={`${headingId}-status`} className={labelStyles}>
              Status
            </label>
            <Select
              id={`${headingId}-status`}
              value={status}
              onChange={(event) => setStatus(event.target.value as ColumnId)}
              className="w-full"
            >
              {(board ? boardLists(board) : DEFAULT_LISTS).map(({ id, name }) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={`${headingId}-priority`} className={labelStyles}>
              Priority
            </label>
            <Select
              id={`${headingId}-priority`}
              value={priority}
              onChange={(event) => setPriority(event.target.value as Priority)}
              className="w-full"
            >
              {PRIORITIES.map(({ id, label }) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor={`${headingId}-due`} className={labelStyles}>
            Due date
          </label>
          <div className="flex items-center gap-2">
            <Input
              id={`${headingId}-due`}
              type="date"
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
              className="w-full"
            />
            {dueDate && (
              <Button variant="ghost" size="sm" onClick={() => setDueDate("")}>
                Clear due date
              </Button>
            )}
          </div>
          <div role="group" aria-label="Quick picks" className="flex flex-wrap items-center gap-2">
            {QUICK_DUE_DATES.map(({ label, days }) => (
              <Button key={label} variant="ghost" size="sm" onClick={() => setDueDate(addDays(todayString(), days))}>
                {label}
              </Button>
            ))}
          </div>
          {dueDate && isValidDueDate(dueDate) && (
            <p data-testid="due-hint" className="text-xs text-zinc-600 dark:text-zinc-400">
              {relativeDueHint(dueDate)}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <span id={`${headingId}-cover`} className={labelStyles}>
            Cover color
          </span>
          {cover && (
            <div
              aria-hidden="true"
              data-testid="cover-preview"
              className={`h-1.5 w-full rounded-full ${coverStyles[cover]}`}
            />
          )}
          <div role="radiogroup" aria-labelledby={`${headingId}-cover`} className="flex flex-wrap gap-2">
            {[{ id: undefined, label: "None" }, ...COVER_COLORS].map(({ id, label }) => (
              <label key={id ?? "none"} className="relative cursor-pointer">
                <input
                  type="radio"
                  name={`${headingId}-cover`}
                  aria-label={`Cover color: ${label}`}
                  checked={cover === id}
                  onChange={() => setCover(id)}
                  className="peer sr-only"
                />
                <span
                  aria-hidden="true"
                  title={label}
                  className={`flex h-7 w-7 items-center justify-center rounded-full border-2 border-line text-sm font-bold text-white peer-checked:ring-2 peer-checked:ring-offset-2 peer-checked:ring-zinc-900 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-blue-600 dark:peer-checked:ring-zinc-100 dark:ring-offset-zinc-900 ${
                    id ? coverStyles[id] : "bg-surface text-muted"
                  }`}
                >
                  {cover === id ? (id ? "✓" : "–") : ""}
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor={`${headingId}-label`} className={labelStyles}>
            Labels
          </label>
          {labels.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {labels.map((label) => (
                <li key={label.toLowerCase()} className="flex items-center gap-1">
                  <LabelChip label={label} />
                  <Button
                    variant="ghost"
                    size="xs"
                    aria-label={`Remove label ${label}`}
                    onClick={() => setLabels(removeLabelFromList(labels, label))}
                  >
                    ×
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center gap-2">
            <Input
              id={`${headingId}-label`}
              value={labelInput}
              aria-invalid={labelError !== null}
              aria-describedby={labelError ? `${headingId}-label-error` : undefined}
              onChange={(event) => {
                setLabelInput(event.target.value);
                setLabelError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addLabel();
                }
              }}
              className="w-full"
            />
            <Button size="sm" onClick={addLabel}>
              Add label
            </Button>
          </div>
          {labelError && (
            <p id={`${headingId}-label-error`} role="alert" className="text-xs text-danger">
              {labelError}
            </p>
          )}
        </div>

        {onChecklist && <ChecklistSection card={card} onChange={onChecklist} />}

        {/* Comment actions apply immediately; they are not part of the draft or the discard prompt. */}
        <CardComments
          comments={card.comments ?? []}
          onAdd={(text) => onUpdateBoard((b) => addComment(b, card.id, text))}
          onEdit={(id, text) => onUpdateBoard((b) => editComment(b, card.id, id, text))}
          onDelete={(id) => onUpdateBoard((b) => deleteComment(b, card.id, id))}
          onCopy={copyComment}
        />

        <p className="text-xs text-muted">
          Created <time dateTime={card.createdAt}>{new Date(card.createdAt).toLocaleString()}</time>
        </p>

        <div className="flex flex-col gap-1">
          <h3 className={labelStyles}>Activity</h3>
          <ActivityLog activity={card.activity} board={board} />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="primary" size="sm" disabled={invalid}>
            Save
          </Button>
          <Button variant="ghost" size="sm" onClick={requestClose}>
            Cancel
          </Button>
          {onDuplicate && (
            <Button variant="ghost" size="sm" title="Duplicates the saved card (unsaved edits are not copied)" onClick={onDuplicate}>
              Duplicate
            </Button>
          )}
          {onCopyText && (
            <Button variant="ghost" size="sm" title="Copies the saved card as plain text (unsaved edits are not copied)" onClick={async () => {
              const result = await onCopyText();
              setCopyKind("card");
              setCopyResult(result);
            }}>
              Copy as text
            </Button>
          )}
          {onMoveToTop && (
            <Button
              variant="ghost"
              size="sm"
              title="Moves the card to the top of its list (unsaved edits are kept but not saved)"
              disabled={!canMoveToTop}
              onClick={onMoveToTop}
            >
              Move to top
            </Button>
          )}
          {onMoveToBottom && (
            <Button
              variant="ghost"
              size="sm"
              title="Moves the card to the bottom of its list (unsaved edits are kept but not saved)"
              disabled={!canMoveToBottom}
              onClick={onMoveToBottom}
            >
              Move to bottom
            </Button>
          )}
          {onArchive && (
            <Button variant="ghost" size="sm" title="Archives the saved card (unsaved edits are not saved)" onClick={onArchive}>
              Archive
            </Button>
          )}
          {onSaveTemplate && (
            <Button
              variant="ghost"
              size="sm"
              title="Saves the saved card as a template (unsaved edits are not copied)"
              onClick={() => setTemplateResult(onSaveTemplate())}
            >
              Save as template
            </Button>
          )}
          <Button variant="danger" size="sm" className="ml-auto" onClick={() => setConfirming("delete")}>
            Delete card
          </Button>
        </div>
        {templateResult && (
          <p role={templateResult.ok ? "status" : "alert"} className={`text-xs ${templateResult.ok ? "text-muted" : "text-danger"}`}>
            {templateResult.message}
          </p>
        )}
      </form>
      {copyResult && <CopyLinkToast result={copyResult} kind={copyKind} onDismiss={dismissCopy} />}
      {confirming === "discard" && (
        <ConfirmDialog
          title="Discard changes"
          message="Discard your unsaved changes?"
          confirmLabel="Discard"
          onConfirm={onClose}
          onCancel={() => setConfirming(null)}
        />
      )}
      {confirming === "delete" && (
        <ConfirmDialog
          title="Delete card"
          message={`Delete "${card.title}"?`}
          confirmLabel="Delete"
          onConfirm={onDelete}
          onCancel={() => setConfirming(null)}
        />
      )}
    </Dialog>
  );
}
