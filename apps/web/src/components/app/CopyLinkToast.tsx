"use client";

import { useEffect } from "react";
import { Toast, ToastAction } from "@/components/ui";

export const COPY_TOAST_MS = 3000;

export type CopyResult = "copied" | { text: string };

// "copied" confirms a successful copy and disappears on its own. A text result means the clipboard
// was unavailable: show the text so it can be copied by hand. "link" is a single line, "markdown"
// can span many lines.
export function CopyLinkToast({
  result,
  kind = "link",
  onDismiss,
}: {
  result: CopyResult;
  kind?: "link" | "markdown" | "card" | "comment";
  onDismiss: () => void;
}) {
  const copied = result === "copied";
  const markdown = kind === "markdown" || kind === "card" || kind === "comment";

  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = setTimeout(onDismiss, COPY_TOAST_MS);
    return () => clearTimeout(timer);
  }, [copied, onDismiss]);

  if (copied) {
    return (
      <Toast>
        <span>{kind === "card" || kind === "comment" ? "Copied" : markdown ? "Copied as Markdown" : "Link copied"}</span>
      </Toast>
    );
  }

  return (
    <Toast>
      <span>
        {kind === "card"
          ? "Could not copy. Copy the text by hand:"
          : kind === "comment"
            ? "Could not copy. Copy the comment by hand:"
            : markdown
            ? "Could not copy. Copy the Markdown by hand:"
            : "Could not copy. Copy the link by hand:"}
      </span>
      {markdown ? (
        <pre className="max-h-[40vh] max-w-[50vw] overflow-auto rounded bg-black/20 px-2 py-1 text-left whitespace-pre select-all dark:bg-white/20">
          {result.text}
        </pre>
      ) : (
        <code className="max-w-[50vw] overflow-x-auto rounded bg-black/20 px-2 py-1 select-all dark:bg-white/20">
          {result.text}
        </code>
      )}
      <ToastAction onClick={onDismiss}>Dismiss</ToastAction>
    </Toast>
  );
}
