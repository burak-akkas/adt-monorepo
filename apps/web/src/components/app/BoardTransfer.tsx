"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { boardLists, listCards, type Board } from "@/lib/board";
import { exportFilename, parseBoard, serializeBoard } from "@/lib/storage";
import { useBoard } from "@/hooks/useBoard";

import { Button } from "@/components/ui";

function countCards(board: Board): number {
  return boardLists(board).reduce((total, { id }) => total + listCards(board, id).length, 0);
}

function readFile(file: File): Promise<string> {
  if (typeof file.text === "function") {
    return file.text();
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

export function BoardTransfer() {
  const [board, update] = useBoard();
  const [pending, setPending] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const importButton = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);

  function exportBoard() {
    const blob = new Blob([serializeBoard(board)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = exportFilename();
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) {
      return;
    }
    let text: string;
    try {
      text = await readFile(file);
    } catch {
      text = "";
    }
    // Reset so picking the same file again still fires a change event.
    input.value = "";
    const result = parseBoard(text);
    if (result.ok) {
      setError(null);
      setPending(result.board);
      // Wait for the panel to render, then focus the safe choice.
      setTimeout(() => cancelButton.current?.focus(), 0);
    } else {
      setPending(null);
      setError(result.error);
    }
  }

  function closeConfirmation() {
    setPending(null);
    importButton.current?.focus();
  }

  function confirmReplace() {
    if (pending) {
      update(() => pending);
    }
    closeConfirmation();
  }

  return (
    <div className="flex min-w-0 flex-col items-start gap-2">
      <div className="flex gap-2">
        <Button size="sm" onClick={exportBoard}>
          Export
        </Button>
        <Button size="sm" ref={importButton} onClick={() => fileInput.current?.click()}>
          Import
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          aria-label="Import board file"
          onChange={onFileChange}
          tabIndex={-1}
          className="sr-only"
        />
      </div>
      {error && (
        <p
          role="alert"
          className="max-w-full rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
        >
          {error}
        </p>
      )}
      {pending && (
        <div
          role="alertdialog"
          aria-labelledby="import-confirm-text"
          className="max-w-full rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"
        >
          <p id="import-confirm-text">
            Replace the current board with the imported one ({countCards(pending)} {countCards(pending) === 1 ? "card" : "cards"})? This cannot be undone.
          </p>
          <div className="mt-2 flex gap-2">
            <Button size="sm" onClick={confirmReplace}>
              Replace
            </Button>
            <Button size="sm" ref={cancelButton} onClick={closeConfirmation}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
