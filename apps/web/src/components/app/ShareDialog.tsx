"use client";

import type { BoardMembersResponse } from "@adt/contracts";
import { useEffect, useId, useState, type FormEvent } from "react";
import { ApiError, inviteMember, listMembers, removeMember } from "@/lib/api-client";
import { Button, Dialog, Input } from "@/components/ui";

export const NO_EMAIL_NOTICE = "No email is sent. Tell the person yourself that you shared this board.";

function inviteMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.kind === "validation") {
      return error.message === "The data was rejected." ? "Enter a valid email address." : error.message;
    }
    if (error.kind === "conflict") {
      return "This person already has access.";
    }
    return error.message;
  }
  return "Could not add this person. Try again.";
}

export function ShareDialog({ boardId, boardName, onClose }: { boardId: string; boardName: string; onClose: () => void }) {
  const id = useId();
  const [people, setPeople] = useState<BoardMembersResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const errorId = `${id}-error`;
  const noticeId = `${id}-notice`;

  // Read again every time the dialog opens: members are not part of the board document.
  useEffect(() => {
    const controller = new AbortController();
    listMembers(boardId, controller.signal).then(setPeople, (failure: unknown) => {
      if (!controller.signal.aborted) {
        setLoadError(failure instanceof Error ? failure.message : "Could not load the list.");
      }
    });
    return () => controller.abort();
  }, [boardId]);

  async function add(event: FormEvent) {
    event.preventDefault();
    if (busy || !email.trim()) {
      setError(email.trim() ? null : "Enter an email address.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const member = await inviteMember(boardId, email.trim());
      setPeople((current) => (current ? { ...current, members: [...current.members, member] } : current));
      setEmail("");
    } catch (failure) {
      setError(inviteMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  async function remove(memberId: string) {
    setError(null);
    try {
      await removeMember(boardId, memberId);
      setPeople((current) => (current ? { ...current, members: current.members.filter((m) => m.id !== memberId) } : current));
    } catch (failure) {
      if (failure instanceof ApiError && failure.kind === "not-found") {
        // Already gone: show it as removed.
        setPeople((current) => (current ? { ...current, members: current.members.filter((m) => m.id !== memberId) } : current));
        return;
      }
      setError(failure instanceof Error ? failure.message : "Could not remove this person.");
    }
  }

  return (
    <Dialog labelledBy={`${id}-title`} onRequestClose={onClose}>
      <div className="flex flex-col gap-3 p-5">
        <h2 id={`${id}-title`} className="text-lg font-semibold">
          Share board
        </h2>
        <p className="text-sm text-subtle">
          People you add can see and edit &ldquo;{boardName}&rdquo; when they sign in with that email.
        </p>
        <p id={noticeId} className="rounded-md bg-amber-50 p-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
          {NO_EMAIL_NOTICE}
        </p>
        <form onSubmit={add} className="flex flex-wrap items-end gap-2" noValidate>
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm font-medium">
            Email
            <Input
              type="email"
              autoFocus
              autoComplete="off"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${noticeId} ${errorId}` : noticeId}
            />
          </label>
          <Button type="submit" variant="primary" disabled={busy}>
            Add
          </Button>
        </form>
        {error && (
          <p id={errorId} role="alert" className="text-sm text-red-700 dark:text-red-300">
            {error}
          </p>
        )}
        <h3 className="text-sm font-semibold">People with access</h3>
        {loadError && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-300">
            {loadError}
          </p>
        )}
        {!people && !loadError && <p className="text-sm text-subtle">Loading…</p>}
        {people && (
          <ul aria-label="People with access" className="flex flex-col gap-1 text-sm">
            <li className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate">{people.owner.email}</span>
              <span className="text-xs text-subtle">Owner</span>
            </li>
            {people.members.map((member) => (
              <li key={member.id} className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate">{member.email}</span>
                <Button size="sm" aria-label={`Remove ${member.email}`} onClick={() => remove(member.id)}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex justify-end">
          <Button onClick={onClose}>Done</Button>
        </div>
      </div>
    </Dialog>
  );
}
