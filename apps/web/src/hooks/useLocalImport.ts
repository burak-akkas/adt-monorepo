"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { hasLocalBoards, importLocalBoards, type FailedBoard } from "@/lib/localImport";

export type LocalImportState =
  | { phase: "idle" }
  | { phase: "running" }
  | { phase: "done"; imported: number; alreadyImported: number; failed: FailedBoard[]; email: string };

interface Options {
  email: string;
  enabled?: boolean;
}

// Moves the boards saved in this browser to the signed-in account. Runs once on mount; `retry` runs again on what is left.
export function useLocalImport({ email, enabled = true }: Options) {
  const [state, setState] = useState<LocalImportState>({ phase: "idle" });
  const started = useRef(false);
  const mounted = useRef(true);
  // Totals of earlier runs: a retry only sees the remaining boards, but the message counts them all.
  const totals = useRef({ imported: 0, alreadyImported: 0 });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(async () => {
    setState({ phase: "running" });
    const result = await importLocalBoards();
    if (!mounted.current) {
      return;
    }
    if (result.status === "nothing") {
      setState({ phase: "idle" });
      return;
    }
    totals.current = {
      imported: totals.current.imported + result.imported,
      alreadyImported: totals.current.alreadyImported + result.alreadyImported,
    };
    setState({ phase: "done", ...totals.current, failed: result.failed, email });
  }, [email]);

  useEffect(() => {
    if (!enabled || started.current || !hasLocalBoards()) {
      return;
    }
    started.current = true;
    void run();
  }, [enabled, run]);

  const retry = useCallback(() => {
    void run();
  }, [run]);

  const dismiss = useCallback(() => setState({ phase: "idle" }), []);

  return { state, retry, dismiss };
}
