"use client";

import { useEffect, useRef, type ReactNode, type SyntheticEvent } from "react";

const SIZE_CLASSES = { md: "max-w-lg", lg: "max-w-3xl" };

export function Dialog({
  labelledBy,
  onRequestClose,
  size = "md",
  children,
}: {
  /** id of the element that names the dialog. */
  labelledBy: string;
  /** Called on Escape and on a backdrop click. The dialog stays open until the parent unmounts it. */
  onRequestClose: () => void;
  /** Maximum width: "md" (32rem, default) or "lg" (48rem). */
  size?: keyof typeof SIZE_CLASSES;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
    }
  }, []);

  function handleCancel(event: SyntheticEvent<HTMLDialogElement>) {
    // Escape: take over from the browser so the parent can decide whether to close.
    event.preventDefault();
    // React bubbles cancel through the component tree, which would also reach a dialog this one is nested in.
    event.stopPropagation();
    onRequestClose();
  }

  return (
    // A click whose target is the <dialog> itself can only land on the backdrop (padding lives on the content).
    <dialog
      ref={dialogRef}
      aria-labelledby={labelledBy}
      onCancel={handleCancel}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onRequestClose();
        }
      }}
      className={`m-auto max-h-[90dvh] w-[calc(100%-1rem)] ${SIZE_CLASSES[size]} overflow-y-auto rounded-xl border border-line bg-surface p-0 text-foreground shadow-xl backdrop:bg-black/50 dark:border-field`}
    >
      {children}
    </dialog>
  );
}
