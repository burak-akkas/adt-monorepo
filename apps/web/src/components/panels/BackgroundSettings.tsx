"use client";

import { useId, useState } from "react";
import type { FormEvent } from "react";
import { parseBackgroundColor, parseBackgroundImageUrl, setBackground } from "@/lib/board";
import type { Board } from "@/lib/board";
import { Button, Input } from "@/components/ui";

const DEFAULT_PICKER_COLOR = "#ffffff";

export function BackgroundSettings({
  board,
  onUpdateBoard,
}: {
  board: Board;
  onUpdateBoard: (change: (board: Board) => Board) => void;
}) {
  const errorId = useId();
  const { background } = board;
  const [draft, setDraft] = useState(background?.type === "image" ? background.url : "");
  const [error, setError] = useState<string | null>(null);

  function pickColor(text: string) {
    const result = parseBackgroundColor(text);
    if (!result.ok) {
      return;
    }
    setError(null);
    setDraft("");
    onUpdateBoard((b) => setBackground(b, { type: "color", value: result.color }));
  }

  function saveImage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = parseBackgroundImageUrl(draft);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setDraft(result.url);
    onUpdateBoard((b) => setBackground(b, { type: "image", url: result.url }));
  }

  function reset() {
    setError(null);
    setDraft("");
    onUpdateBoard((b) => setBackground(b, undefined));
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <h4 className="text-sm font-medium">Board background</h4>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-sm">
          Background color
          <input
            type="color"
            value={background?.type === "color" ? background.value : DEFAULT_PICKER_COLOR}
            onChange={(event) => pickColor(event.target.value)}
            className="h-8 w-12 cursor-pointer rounded border border-zinc-300 bg-transparent p-0.5 dark:border-zinc-600"
          />
        </label>
        <Button size="xs" onClick={reset}>
          Reset background
        </Button>
      </div>
      <form onSubmit={saveImage} noValidate className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            fieldSize="sm"
            type="url"
            aria-label="Background image URL"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            placeholder="https://example.com/picture.jpg"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            className="min-w-0 flex-1"
          />
          <Button type="submit" size="xs" variant="primary">
            Set image
          </Button>
        </div>
        {error && (
          <p id={errorId} role="alert" className="text-xs text-danger">
            {error}
          </p>
        )}
      </form>
    </div>
  );
}
