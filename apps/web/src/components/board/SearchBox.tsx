"use client";

import { useRef } from "react";
import { Input } from "@/components/ui";

export function SearchBox({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="relative">
      <Input
        ref={inputRef}
        type="text"
        aria-label="Search cards"
        placeholder="Search cards"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            onChange("");
          }
        }}
        className="w-full pr-10"
      />
      {value !== "" && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            onChange("");
            inputRef.current?.focus();
          }}
          className="absolute inset-y-0 right-0 rounded-lg px-3 text-muted hover:text-foreground"
        >
          ×
        </button>
      )}
    </div>
  );
}
