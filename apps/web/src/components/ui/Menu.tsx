"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Button } from "./Button";

export type MenuItem = {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
};

type Focus = "first" | "last";

/** A button that opens a popup list of actions (`role="menu"`) with roving keyboard focus. */
export function Menu({ label, icon, items }: { label: string; icon: ReactNode; items: MenuItem[] }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [focusTarget, setFocusTarget] = useState<Focus>("first");
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = `${id}-menu`;

  function enabledIndexes() {
    return items.flatMap((item, index) => (item.disabled ? [] : [index]));
  }

  function focusItem(index: number | undefined) {
    if (index !== undefined) itemRefs.current[index]?.focus();
  }

  function openMenu(target: Focus) {
    setFocusTarget(target);
    setOpen(true);
  }

  function closeMenu(restoreFocus: boolean) {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    const enabled = items.flatMap((item, index) => (item.disabled ? [] : [index]));
    const index = focusTarget === "first" ? enabled[0] : enabled[enabled.length - 1];
    if (index !== undefined) itemRefs.current[index]?.focus();
    // Focus only when the menu opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function onTriggerKeyDown(event: KeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      openMenu("first");
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      openMenu("last");
    }
  }

  function onMenuKeyDown(event: KeyboardEvent) {
    const enabled = enabledIndexes();
    if (enabled.length === 0 && event.key !== "Escape" && event.key !== "Tab") return;
    const current = enabled.indexOf(itemRefs.current.findIndex((el) => el === document.activeElement));
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusItem(enabled[(current + 1) % enabled.length]);
        break;
      case "ArrowUp":
        event.preventDefault();
        focusItem(enabled[(current - 1 + enabled.length) % enabled.length]);
        break;
      case "Home":
        event.preventDefault();
        focusItem(enabled[0]);
        break;
      case "End":
        event.preventDefault();
        focusItem(enabled[enabled.length - 1]);
        break;
      case "Escape":
        event.preventDefault();
        closeMenu(true);
        break;
      case "Tab":
        setOpen(false);
        break;
    }
  }

  function select(item: MenuItem) {
    if (item.disabled) return;
    // Close first so a dialog opened by `onSelect` takes focus and restores it cleanly.
    closeMenu(false);
    item.onSelect();
  }

  return (
    <div ref={rootRef} className="relative">
      <Button
        ref={triggerRef}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? closeMenu(false) : openMenu("first"))}
        onKeyDown={onTriggerKeyDown}
      >
        {icon}
      </Button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKeyDown}
          className="absolute left-0 z-20 mt-1 flex min-w-40 flex-col rounded-lg border border-line bg-surface p-1 shadow-lg"
        >
          {items.map((item, index) => (
            <button
              key={item.label}
              ref={(el) => {
                itemRefs.current[index] = el;
              }}
              type="button"
              role="menuitem"
              tabIndex={-1}
              aria-disabled={item.disabled || undefined}
              onClick={() => select(item)}
              className="rounded-md px-3 py-1.5 text-left text-sm outline-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
