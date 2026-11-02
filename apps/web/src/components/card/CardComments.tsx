"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { MAX_COMMENT_LENGTH, type CardComment } from "@/lib/board";
import { formatRelativeTime } from "@/lib/time";
import { Button, Textarea } from "@/components/ui";
import { useCommentOrder } from "@/hooks/useCommentOrder";

const labelStyles = "text-xs font-medium text-subtle";

const exactTime = (iso: string) => new Date(iso).toLocaleString();

export function CardComments({
  comments,
  onAdd,
  onEdit,
  onDelete,
  onCopy,
}: {
  comments: readonly CardComment[];
  onAdd: (text: string) => void;
  onEdit: (id: string, text: string) => void;
  onDelete: (id: string) => void;
  onCopy?: (text: string) => void;
}) {
  const baseId = useId();
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const newRef = useRef<HTMLTextAreaElement>(null);
  const editRef = useRef<HTMLTextAreaElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  // `now` is taken once per render; there is no ticking timer.
  const now = new Date();
  const [order, setOrder] = useCommentOrder();
  const newestFirst = order === "newest" && comments.length >= 2;
  // `position` is the chronological number, so labels stay stable in either order.
  const numbered = comments.map((comment, index) => ({ comment, position: index + 1 }));
  const shown = newestFirst ? numbered.reverse() : numbered;

  useEffect(() => {
    if (editingId) {
      editRef.current?.focus();
    }
  }, [editingId]);

  useEffect(() => {
    if (confirmingId) {
      confirmRef.current?.focus();
    }
  }, [confirmingId]);

  function post() {
    if (!draft.trim()) {
      return;
    }
    onAdd(draft);
    setDraft("");
  }

  function handleNewKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      post();
    }
  }

  function saveEdit(id: string) {
    if (!editDraft.trim()) {
      return;
    }
    onEdit(id, editDraft);
    setEditingId(null);
  }

  function handleEditKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Escape") {
      // Cancel the edit only; the dialog must stay open.
      event.preventDefault();
      event.stopPropagation();
      setEditingId(null);
    }
  }

  function confirmDelete(id: string) {
    onDelete(id);
    setConfirmingId(null);
    newRef.current?.focus();
  }

  return (
    <section aria-labelledby={`${baseId}-heading`} className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 id={`${baseId}-heading`} className={labelStyles}>
          {comments.length > 0 ? `Comments (${comments.length})` : "Comments"}
        </h3>
        {comments.length >= 2 && (
          <Button
            variant="ghost"
            size="xs"
            aria-pressed={newestFirst}
            onClick={() => setOrder(newestFirst ? "oldest" : "newest")}
          >
            Newest first
          </Button>
        )}
      </div>

      {comments.length > 0 && (
        <ul aria-label="Comments" className="flex flex-col gap-2">
          {shown.map(({ comment, position }) => {
            const exact = exactTime(comment.createdAt);
            const tipId = `${baseId}-tip-${comment.id}`;
            return (
              <li key={comment.id} className="flex min-w-0 flex-col gap-1 rounded-lg border border-line p-2">
                {editingId === comment.id ? (
                  <div className="flex flex-col gap-2">
                    <Textarea
                      ref={editRef}
                      aria-label={`Edit comment ${position}`}
                      value={editDraft}
                      maxLength={MAX_COMMENT_LENGTH}
                      rows={3}
                      onChange={(event) => setEditDraft(event.target.value)}
                      onKeyDown={handleEditKeyDown}
                      className="w-full"
                    />
                    <div className="flex flex-wrap items-center gap-1">
                      <Button variant="primary" size="xs" disabled={!editDraft.trim()} onClick={() => saveEdit(comment.id)}>
                        Save comment
                      </Button>
                      <Button variant="ghost" size="xs" onClick={() => setEditingId(null)}>
                        Cancel edit
                      </Button>
                      <span className="ml-auto text-xs text-muted" aria-hidden="true">
                        {editDraft.length}/{MAX_COMMENT_LENGTH}
                      </span>
                    </div>
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap break-words text-sm">{comment.text}</p>
                )}
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                  <span className="group relative">
                    <time
                      dateTime={comment.createdAt}
                      title={exact}
                      tabIndex={0}
                      aria-describedby={tipId}
                      className="rounded outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      {formatRelativeTime(comment.createdAt, now)}
                    </time>
                    <span
                      id={tipId}
                      role="tooltip"
                      className="pointer-events-none absolute left-0 top-full z-10 mt-1 whitespace-nowrap rounded-md border border-line bg-surface px-2 py-1 text-xs text-foreground opacity-0 shadow-md group-focus-within:opacity-100 group-hover:opacity-100"
                    >
                      {exact}
                    </span>
                  </span>
                  {comment.editedAt && (
                    <span title={`Edited ${exactTime(comment.editedAt)}`} className="italic">
                      edited
                    </span>
                  )}
                  {editingId !== comment.id && confirmingId !== comment.id && (
                    <span className="ml-auto flex items-center gap-1">
                      {onCopy && (
                        <Button variant="ghost" size="xs" aria-label={`Copy comment ${position}`} onClick={() => onCopy(comment.text)}>
                          Copy
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="xs"
                        aria-label={`Edit comment ${position}`}
                        onClick={() => {
                          setConfirmingId(null);
                          setEditDraft(comment.text);
                          setEditingId(comment.id);
                        }}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="danger"
                        size="xs"
                        aria-label={`Delete comment ${position}`}
                        onClick={() => {
                          setEditingId(null);
                          setConfirmingId(comment.id);
                        }}
                      >
                        Delete
                      </Button>
                    </span>
                  )}
                </div>
                {confirmingId === comment.id && (
                  <div role="group" aria-label={`Confirm deleting comment ${position}`} className="flex flex-wrap items-center gap-2">
                    <span className="text-sm">Delete this comment?</span>
                    <Button ref={confirmRef} variant="danger" size="xs" onClick={() => confirmDelete(comment.id)}>
                      Confirm delete
                    </Button>
                    <Button variant="ghost" size="xs" onClick={() => setConfirmingId(null)}>
                      Keep
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-col gap-1">
        <label htmlFor={`${baseId}-new`} className={labelStyles}>
          New comment
        </label>
        <Textarea
          ref={newRef}
          id={`${baseId}-new`}
          value={draft}
          maxLength={MAX_COMMENT_LENGTH}
          rows={3}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleNewKeyDown}
          aria-keyshortcuts="Control+Enter Meta+Enter"
          className="w-full"
        />
        <div className="flex items-center gap-2">
          <Button size="sm" disabled={!draft.trim()} onClick={post}>
            Add comment
          </Button>
          <span className="text-xs text-muted">Ctrl+Enter to post</span>
          <span className="ml-auto text-xs text-muted" aria-hidden="true">
            {draft.length}/{MAX_COMMENT_LENGTH}
          </span>
        </div>
      </div>
    </section>
  );
}
