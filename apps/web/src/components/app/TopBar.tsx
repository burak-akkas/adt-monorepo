"use client";

import { useRef, useState } from "react";

import { BoardSwitcher } from "@/components/app/BoardSwitcher";
import { KeyboardShortcuts } from "@/components/app/KeyboardShortcuts";
import { SettingsPanel } from "@/components/panels/SettingsPanel";
import { Button, GearIcon } from "@/components/ui";
import { useBoard } from "@/hooks/useBoard";

function SettingsButton() {
  const [board, update] = useBoard();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  function close() {
    setOpen(false);
    requestAnimationFrame(() => buttonRef.current?.focus());
  }

  return (
    <>
      <Button
        ref={buttonRef}
        variant="ghost"
        aria-label="Settings"
        title="Settings"
        aria-haspopup="dialog"
        className="p-2"
        onClick={() => setOpen(true)}
      >
        <GearIcon />
      </Button>
      {open && <SettingsPanel board={board} onUpdateBoard={update} onClose={close} />}
    </>
  );
}

export function TopBar() {
  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-4 py-3 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">Kanban</h1>
      <div className="min-w-0 max-w-full">
        <BoardSwitcher />
      </div>
      <div className="ml-auto flex items-center gap-1">
        <KeyboardShortcuts />
        <SettingsButton />
      </div>
    </header>
  );
}
