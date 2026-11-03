"use client";

import type { LocalImportState } from "@/hooks/useLocalImport";
import type { FailedBoard } from "@/lib/localImport";
import { exportFilename, serializeBoard } from "@/lib/storage";
import { Button } from "@/components/ui";

function downloadBoard(board: FailedBoard["board"]) {
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

function reason(failure: FailedBoard): string {
  return failure.error.status === 413 ? "too large to import" : failure.error.message;
}

export function ImportBanner({
  state,
  onRetry,
  onDismiss,
}: {
  state: LocalImportState;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  if (state.phase !== "done" || (state.imported === 0 && state.failed.length === 0)) {
    return null;
  }
  const { imported, failed, email } = state;
  return (
    <div className="flex flex-col gap-2 text-sm">
      {imported > 0 && (
        <div
          role="status"
          className="flex items-center justify-between gap-3 rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-green-900 dark:border-green-900 dark:bg-green-950 dark:text-green-100"
        >
          <p>
            {imported} {imported === 1 ? "board from this browser was" : "boards from this browser were"} added to your account ({email}).
          </p>
          {failed.length === 0 && (
            <Button size="sm" onClick={onDismiss}>
              Dismiss
            </Button>
          )}
        </div>
      )}
      {failed.length > 0 && (
        <div
          role="alert"
          className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
        >
          <p>
            {failed.length === 1 ? "1 board" : `${failed.length} boards`} from this browser could not be added to your account. They are still saved in this browser.
          </p>
          <ul className="mt-2 flex flex-col gap-2">
            {failed.map((failure) => (
              <li key={failure.id} className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1">
                  <strong>{failure.name}</strong>: {reason(failure)}
                </span>
                <Button size="sm" aria-label={`Download ${failure.name}`} onClick={() => downloadBoard(failure.board)}>
                  Download
                </Button>
                {failure.transient && (
                  <Button size="sm" aria-label={`Retry importing ${failure.name}`} onClick={onRetry}>
                    Retry
                  </Button>
                )}
              </li>
            ))}
          </ul>
          <div className="mt-2">
            <Button size="sm" onClick={onDismiss}>
              Dismiss
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
