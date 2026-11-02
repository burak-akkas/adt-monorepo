"use client";

import { useId, useState } from "react";
import type { FormEvent } from "react";
import { boardLists, MAX_WIP_LIMIT, parseWipLimit, setWipLimit } from "@/lib/board";
import type { Board } from "@/lib/board";
import { BoardTransfer } from "@/components/app/BoardTransfer";
import { Button, Dialog, Input } from "@/components/ui";
import { ThemeToggle } from "@/components/app/ThemeToggle";
import { formatVersionLine } from "@/lib/version";
import { BackgroundSettings } from "./BackgroundSettings";
import { ListChoice } from "./ListChoice";

function WipLimitRow({
  id,
  name,
  limit,
  onUpdateBoard,
}: {
  id: string;
  name: string;
  limit: number | undefined;
  onUpdateBoard: (change: (board: Board) => Board) => void;
}) {
  const [draft, setDraft] = useState(limit === undefined ? "" : String(limit));
  const [error, setError] = useState<string | null>(null);

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = parseWipLimit(draft);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setDraft(result.limit === undefined ? "" : String(result.limit));
    onUpdateBoard((b) => (boardLists(b).some((l) => l.id === id) ? setWipLimit(b, id, result.limit) : b));
  }

  function clear() {
    setError(null);
    setDraft("");
    onUpdateBoard((b) => (boardLists(b).some((l) => l.id === id) ? setWipLimit(b, id, undefined) : b));
  }

  return (
    <li>
      <form onSubmit={save} noValidate className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 flex-1 break-words text-sm">{name}</span>
          <span className="text-xs text-muted">{limit === undefined ? "No limit" : `Limit ${limit}`}</span>
          <Input
            fieldSize="sm"
            inputMode="numeric"
            aria-label={`WIP limit for ${name}`}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `settings-wip-error-${id}` : undefined}
            placeholder={`1-${MAX_WIP_LIMIT}`}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            className="w-20"
          />
          <Button type="submit" size="xs" variant="primary" aria-label={`Save WIP limit for ${name}`}>
            Save
          </Button>
          <Button size="xs" onClick={clear} aria-label={`Clear WIP limit for ${name}`}>
            Clear
          </Button>
        </div>
        {error && (
          <p id={`settings-wip-error-${id}`} role="alert" className="text-xs text-danger">
            {error}
          </p>
        )}
      </form>
    </li>
  );
}

export function SettingsPanel({
  board,
  onClose,
  onUpdateBoard,
}: {
  board: Board;
  onClose: () => void;
  onUpdateBoard: (change: (board: Board) => Board) => void;
}) {
  const headingId = useId();
  const wipHeadingId = useId();
  const transferHeadingId = useId();
  const themeHeadingId = useId();
  const versionLine = formatVersionLine(process.env.NEXT_PUBLIC_APP_VERSION, process.env.NEXT_PUBLIC_COMMIT_SHA);
  return (
    <Dialog labelledBy={headingId} onRequestClose={onClose}>
      <div className="flex max-w-full min-w-0 flex-col gap-5 p-5">
        <h2 id={headingId} className="text-lg font-semibold">
          Settings
        </h2>
        <section aria-labelledby={themeHeadingId} className="flex min-w-0 flex-col gap-2">
          <h3 id={themeHeadingId} className="text-sm font-semibold">
            Appearance
          </h3>
          <ThemeToggle />
          <BackgroundSettings board={board} onUpdateBoard={onUpdateBoard} />
        </section>
        <ListChoice board={board} onUpdateBoard={onUpdateBoard} />
        <section aria-labelledby={wipHeadingId} className="flex min-w-0 flex-col gap-2">
          <h3 id={wipHeadingId} className="text-sm font-semibold">
            WIP limits
          </h3>
          <ul className="flex flex-col gap-2">
            {boardLists(board).map((l) => (
              <WipLimitRow
                key={`${l.id}:${board.wipLimits?.[l.id] ?? ""}`}
                id={l.id}
                name={l.name}
                limit={board.wipLimits?.[l.id]}
                onUpdateBoard={onUpdateBoard}
              />
            ))}
          </ul>
        </section>
        <section aria-labelledby={transferHeadingId} className="flex min-w-0 flex-col gap-2">
          <h3 id={transferHeadingId} className="text-sm font-semibold">
            Import / Export
          </h3>
          <BoardTransfer />
        </section>
        {versionLine && <p className="text-xs text-muted">{versionLine}</p>}
        <div className="flex">
          <Button variant="primary" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
