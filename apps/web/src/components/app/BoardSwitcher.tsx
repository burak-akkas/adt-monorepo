"use client";

import { useCallback, useId, useState, type FormEvent } from "react";
import { boardLink, MAX_BOARD_NAME_LENGTH, type NameResult } from "@/lib/boards";
import { boardToMarkdown } from "@/lib/boardMarkdown";
import { CopyLinkToast, type CopyResult } from "@/components/app/CopyLinkToast";
import {
  archiveDone,
  boardLists,
  collapseAllLists,
  collapseEmptyLists,
  emptyArchive,
  expandAllLists,
  hasDueDates,
  hasExpandedEmptyList,
  insightsListIds,
  isListCollapsed,
  listCards,
  sortListsByDueDate,
} from "@/lib/board";
import { useBoard, useBoards } from "@/hooks/useBoard";

import { Button, ConfirmDialog, Dialog, Input, Menu, MoreIcon, Select } from "@/components/ui";

type Dialogs = "create" | "rename" | "delete" | "archive" | "empty" | null;

function BoardNameDialog({
  title,
  submitLabel,
  initialName,
  onSubmit,
  onClose,
}: {
  title: string;
  submitLabel: string;
  initialName: string;
  onSubmit: (name: string) => NameResult;
  onClose: () => void;
}) {
  const id = useId();
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  function submit(event: FormEvent) {
    event.preventDefault();
    const result = onSubmit(name);
    if (result.ok) {
      onClose();
    } else {
      setError(result.error);
    }
  }

  return (
    <Dialog labelledBy={`${id}-title`} onRequestClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-3 p-5">
        <h2 id={`${id}-title`} className="text-lg font-semibold">
          {title}
        </h2>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Board name
          <Input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${hintId} ${errorId}` : hintId}
          />
        </label>
        <p id={hintId} className="text-xs text-subtle">
          Up to {MAX_BOARD_NAME_LENGTH} characters ({name.trim().length}/{MAX_BOARD_NAME_LENGTH})
        </p>
        {error && (
          <p id={errorId} role="alert" className="text-sm text-red-700 dark:text-red-300">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary">
            {submitLabel}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function BoardSwitcher() {
  const { boards, currentId, createBoard, renameBoard, duplicateBoard, deleteBoard, selectBoard } = useBoards();
  const [board, update] = useBoard();
  const lists = boardLists(board);
  const [dialog, setDialog] = useState<Dialogs>(null);
  const current = boards.find((b) => b.id === currentId) ?? boards[0];
  const close = () => setDialog(null);
  const [copy, setCopy] = useState<{ kind: "link" | "markdown"; result: CopyResult } | null>(null);
  const dismissCopy = useCallback(() => setCopy(null), []);

  async function copyText(kind: "link" | "markdown", text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopy({ kind, result: "copied" });
    } catch {
      setCopy({ kind, result: { text } });
    }
  }
  const copyLink = () => copyText("link", boardLink(currentId, window.location.href));
  const copyMarkdown = () => copyText("markdown", boardToMarkdown(board, current.name));
  const doneId = insightsListIds(board).done;
  const doneCount = doneId === undefined ? 0 : listCards(board, doneId).length;
  const archivedCount = board.archive.length;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        aria-label="Board"
        value={currentId}
        onChange={(event) => selectBoard(event.target.value)}
        className="max-w-full min-w-0"
      >
        {boards.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </Select>
      <Menu
        label="Board actions"
        icon={<MoreIcon />}
        items={[
          { label: "New board", onSelect: () => setDialog("create") },
          { label: "Rename board", onSelect: () => setDialog("rename") },
          { label: "Duplicate board", onSelect: duplicateBoard },
          { label: "Copy board link", onSelect: copyLink },
          { label: "Copy as Markdown", onSelect: copyMarkdown },
          { label: "Delete board", disabled: boards.length <= 1, onSelect: () => setDialog("delete") },
          {
            label: "Collapse all lists",
            disabled: lists.length === 0 || lists.every((l) => isListCollapsed(board, l.id)),
            onSelect: () => update(collapseAllLists),
          },
          {
            label: "Collapse empty lists",
            disabled: !hasExpandedEmptyList(board),
            onSelect: () => update(collapseEmptyLists),
          },
          {
            label: "Expand all lists",
            disabled: !board.collapsedLists?.length,
            onSelect: () => update(expandAllLists),
          },
          { label: "Sort lists by due date", disabled: !hasDueDates(board), onSelect: () => update(sortListsByDueDate) },
          { label: "Archive done cards", disabled: doneCount === 0, onSelect: () => setDialog("archive") },
          { label: "Empty archive", disabled: archivedCount === 0, onSelect: () => setDialog("empty") },
        ]}
      />
      {copy && <CopyLinkToast result={copy.result} kind={copy.kind} onDismiss={dismissCopy} />}
      {dialog === "create" && (
        <BoardNameDialog title="New board" submitLabel="Create" initialName="" onSubmit={createBoard} onClose={close} />
      )}
      {dialog === "rename" && (
        <BoardNameDialog
          title="Rename board"
          submitLabel="Rename"
          initialName={current.name}
          onSubmit={(name) => renameBoard(current.id, name)}
          onClose={close}
        />
      )}
      {dialog === "archive" && (
        <ConfirmDialog
          title="Archive done cards"
          message={`Archive all ${doneCount} ${doneCount === 1 ? "card" : "cards"} in the done list? You can restore them from the archive.`}
          confirmLabel="Archive"
          onConfirm={() => {
            update((b) => archiveDone(b));
            close();
          }}
          onCancel={close}
        />
      )}
      {dialog === "empty" && (
        <ConfirmDialog
          title="Empty archive"
          message={`Permanently delete ${archivedCount} ${archivedCount === 1 ? "card" : "cards"} from the archive? This cannot be undone.`}
          confirmLabel="Delete"
          onConfirm={() => {
            update(emptyArchive);
            close();
          }}
          onCancel={close}
        />
      )}
      {dialog === "delete" && (
        <ConfirmDialog
          title="Delete board"
          message={<>Delete &ldquo;{current.name}&rdquo; and all its cards? This cannot be undone.</>}
          confirmLabel="Delete"
          onConfirm={() => {
            deleteBoard(current.id);
            close();
          }}
          onCancel={close}
        />
      )}
    </div>
  );
}
