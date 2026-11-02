"use client";

import { useId, type ReactNode } from "react";

import { Button } from "./Button";
import { Dialog } from "./Dialog";

/** In-app replacement for window.confirm. Cancel is focused first; Escape and the backdrop cancel. */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const id = useId();
  return (
    <Dialog labelledBy={`${id}-title`} onRequestClose={onCancel}>
      <div className="flex flex-col gap-3 p-5">
        <h2 id={`${id}-title`} className="text-lg font-semibold">
          {title}
        </h2>
        <p className="text-sm">{message}</p>
        <div className="flex justify-end gap-2">
          <Button autoFocus onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
