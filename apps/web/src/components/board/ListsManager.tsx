"use client";

import { useId, useState, type FormEvent } from "react";
import {
  addList,
  boardLists,
  deleteList,
  listCards,
  MAX_LIST_NAME_LENGTH,
  moveList,
  renameList,
  validateListName,
  type Board,
  type List,
} from "@/lib/board";
import { Button, ConfirmDialog, Dialog, Input, Select } from "@/components/ui";

function ListRow({
  board,
  list,
  index,
  count,
  onUpdateBoard,
}: {
  board: Board;
  list: List;
  index: number;
  count: number;
  onUpdateBoard: (change: (board: Board) => Board) => void;
}) {
  const id = useId();
  const [name, setName] = useState(list.name);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const cards = listCards(board, list.id).length;
  const others = boardLists(board).filter((l) => l.id !== list.id);
  const [target, setTarget] = useState(others[0]?.id ?? "");

  function rename(event: FormEvent) {
    event.preventDefault();
    const result = validateListName(name, boardLists(board), list.id);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setName(result.name);
    onUpdateBoard((b) => renameList(b, list.id, result.name));
  }

  function remove() {
    if (count <= 1) {
      return;
    }
    if (cards > 0) {
      setTarget((current) => (others.some((l) => l.id === current) ? current : (others[0]?.id ?? "")));
      setDeleting(true);
      return;
    }
    setConfirming(true);
  }

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-line p-3 dark:border-field">
      <form onSubmit={rename} className="flex flex-wrap items-center gap-2" noValidate>
        <Input
          aria-label={`Name of list "${list.name}"`}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="min-w-0 flex-1"
        />
        <Button type="submit" size="sm" aria-label={`Rename list "${list.name}"`}>
          Rename
        </Button>
      </form>
      {error && (
        <p id={`${id}-error`} role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted">
          {cards} {cards === 1 ? "card" : "cards"}
        </span>
        <Button
          size="sm"
          className="ml-auto"
          aria-label={`Move list "${list.name}" left`}
          disabled={index === 0}
          onClick={() => onUpdateBoard((b) => moveList(b, list.id, -1))}
        >
          ←
        </Button>
        <Button
          size="sm"
          aria-label={`Move list "${list.name}" right`}
          disabled={index === count - 1}
          onClick={() => onUpdateBoard((b) => moveList(b, list.id, 1))}
        >
          →
        </Button>
        <Button
          size="sm"
          variant="danger"
          aria-label={`Delete list "${list.name}"`}
          disabled={count <= 1}
          title={count <= 1 ? "The last list cannot be deleted" : undefined}
          onClick={remove}
        >
          Delete
        </Button>
      </div>
      {deleting && (
        <div role="group" aria-label={`Move cards out of "${list.name}"`} className="flex flex-col gap-2 rounded-md bg-surface-muted p-2">
          <label className="flex flex-col gap-1 text-xs font-medium">
            Move {cards} {cards === 1 ? "card" : "cards"} to
            <Select value={target} onChange={(event) => setTarget(event.target.value)} className="w-full">
              {others.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          </label>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="danger"
              onClick={() => {
                onUpdateBoard((b) => (listCards(b, list.id).length === 0 || others.some((l) => l.id === target) ? deleteList(b, list.id, target) : b));
                setDeleting(false);
              }}
            >
              Move cards and delete list
            </Button>
            <Button size="sm" onClick={() => setDeleting(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {confirming && (
        <ConfirmDialog
          title="Delete list"
          message={`Delete the empty list "${list.name}"?`}
          confirmLabel="Delete"
          onConfirm={() => onUpdateBoard((b) => deleteList(b, list.id))}
          onCancel={() => setConfirming(false)}
        />
      )}
    </li>
  );
}

export function ListsManager({
  board,
  onUpdateBoard,
  onClose,
}: {
  board: Board;
  onUpdateBoard: (change: (board: Board) => Board) => void;
  onClose: () => void;
}) {
  const headingId = useId();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const lists = boardLists(board);

  function add(event: FormEvent) {
    event.preventDefault();
    const result = validateListName(name, lists);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setName("");
    onUpdateBoard((b) => addList(b, result.name));
  }

  return (
    <Dialog labelledBy={headingId} onRequestClose={onClose}>
      <div className="flex flex-col gap-4 p-5">
        <h2 id={headingId} className="text-lg font-semibold">
          Manage lists
        </h2>
        <ul aria-label="Lists" className="flex flex-col gap-2">
          {lists.map((list, index) => (
            <ListRow
              // The name is part of the key so a renamed list resets its edit field.
              key={`${list.id}:${list.name}`}
              board={board}
              list={list}
              index={index}
              count={lists.length}
              onUpdateBoard={onUpdateBoard}
            />
          ))}
        </ul>
        <form onSubmit={add} className="flex flex-col gap-2" noValidate>
          <div className="flex gap-2">
            <Input
              aria-label="New list name"
              placeholder="New list"
              value={name}
              maxLength={MAX_LIST_NAME_LENGTH * 2}
              aria-invalid={error ? true : undefined}
              onChange={(event) => setName(event.target.value)}
              className="min-w-0 flex-1"
            />
            <Button type="submit" variant="primary">
              Add list
            </Button>
          </div>
          {error && (
            <p role="alert" className="text-xs text-danger">
              {error}
            </p>
          )}
        </form>
        <div className="flex">
          <Button variant="primary" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
