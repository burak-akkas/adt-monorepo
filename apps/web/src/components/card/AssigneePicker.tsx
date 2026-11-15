"use client";

import { useEffect, useId, useState } from "react";
import { listMembers } from "@/lib/api-client";

type Load = { status: "loading" } | { status: "error" } | { status: "ready"; people: string[] };

export function AssigneePicker({
  boardId,
  assignees,
  onAssign,
  onUnassign,
}: {
  boardId: string;
  assignees: readonly string[];
  onAssign: (email: string) => void;
  onUnassign: (email: string) => void;
}) {
  const headingId = useId();
  const [load, setLoad] = useState<Load>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    listMembers(boardId, controller.signal).then(
      (response) => {
        const emails = [response.owner.email, ...response.members.map((m) => m.email)].map((e) => e.trim().toLowerCase());
        setLoad({ status: "ready", people: Array.from(new Set(emails)) });
      },
      () => {
        if (!controller.signal.aborted) {
          setLoad({ status: "error" });
        }
      },
    );
    return () => controller.abort();
  }, [boardId]);

  if (load.status === "loading") {
    return (
      <p role="status" className="text-xs text-muted">
        Loading board members…
      </p>
    );
  }
  if (load.status === "error") {
    return (
      <p role="status" className="text-xs text-muted">
        Could not load board members.
      </p>
    );
  }

  // Someone assigned who is no longer a member stays listed so they can be removed.
  const people = [...load.people, ...assignees.filter((a) => !load.people.includes(a))];

  return (
    <fieldset aria-labelledby={headingId} className="flex flex-col gap-1">
      <legend id={headingId} className="text-xs font-medium text-subtle">
        Assignees
      </legend>
      <ul className="flex flex-col gap-1">
        {people.map((email) => (
          <li key={email}>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={assignees.includes(email)}
                onChange={(event) => (event.target.checked ? onAssign(email) : onUnassign(email))}
              />
              {email}
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}
