"use client";

import { useEffect } from "react";
import { Toast, ToastAction } from "@/components/ui";

export const UNDO_TOAST_MS = 6000;

export function UndoToast({
  message,
  onUndo,
  onDismiss,
}: {
  message: string;
  onUndo: () => void;
  onDismiss: () => void;
}) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, UNDO_TOAST_MS);
    return () => clearTimeout(timer);
  }, [message, onDismiss]);

  return (
    <Toast>
      <span>{message}</span>
      <ToastAction onClick={onUndo}>Undo</ToastAction>
    </Toast>
  );
}
