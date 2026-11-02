"use client";

import { useEffect, useId, useRef, useState } from "react";

import { Button, Dialog, KeyboardIcon } from "@/components/ui";

type ShortcutAction = "add-card" | "search" | "help";

export const SHORTCUTS: ReadonlyArray<{ key: string; action: ShortcutAction; description: string }> = [
  { key: "n", action: "add-card", description: "Focus the new card title" },
  { key: "/", action: "search", description: "Focus the card search" },
  { key: "?", action: "help", description: "Show this help" },
];

/** Maps a keydown event to a shortcut action, or null when it must be left alone. */
export function shortcutFor(event: KeyboardEvent): ShortcutAction | null {
  if (event.defaultPrevented || event.repeat || event.ctrlKey || event.metaKey || event.altKey) {
    return null;
  }
  const target = event.target;
  if (target instanceof HTMLElement) {
    if (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) {
      return null;
    }
  }
  if (document.querySelector("dialog[open]")) {
    return null;
  }
  return SHORTCUTS.find((shortcut) => shortcut.key === event.key)?.action ?? null;
}

export function KeyboardShortcuts() {
  const headingId = useId();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  function openHelp() {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOpen(true);
  }

  function closeHelp() {
    setOpen(false);
    const previous = returnFocusRef.current;
    requestAnimationFrame(() => {
      const target = previous && previous !== document.body && previous.isConnected ? previous : buttonRef.current;
      target?.focus();
    });
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const action = shortcutFor(event);
      if (!action) {
        return;
      }
      event.preventDefault();
      if (action === "help") {
        returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setOpen(true);
        return;
      }
      const label = action === "add-card" ? "New card title" : "Search cards";
      document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)?.focus();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <>
      <Button
        ref={buttonRef}
        variant="ghost"
        aria-label="Keyboard shortcuts"
        title="Keyboard shortcuts"
        aria-haspopup="dialog"
        className="p-2"
        onClick={openHelp}
      >
        <KeyboardIcon />
      </Button>
      {open && (
        <Dialog labelledBy={headingId} onRequestClose={closeHelp}>
          <div className="flex flex-col gap-4 p-5">
            <h2 id={headingId} className="text-lg font-semibold">
              Keyboard shortcuts
            </h2>
            <dl className="flex flex-col gap-2">
              {SHORTCUTS.map(({ key, description }) => (
                <div key={key} className="flex items-center gap-3">
                  <dt>
                    <kbd className="inline-block min-w-7 rounded-md border border-line bg-surface-hover px-2 py-0.5 text-center font-mono text-xs text-foreground dark:border-field">
                      {key}
                    </kbd>
                  </dt>
                  <dd className="text-sm text-subtle">{description}</dd>
                </div>
              ))}
            </dl>
            <div className="flex">
              <Button variant="primary" size="sm" onClick={closeHelp}>
                Close
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
}
