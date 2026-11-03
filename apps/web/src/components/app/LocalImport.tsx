"use client";

import type { ReactNode } from "react";

import { ImportBanner } from "@/components/app/ImportBanner";
import { useAuth } from "@/hooks/useAuth";
import { refreshBoards } from "@/hooks/serverBoardStore";
import { useLocalImport } from "@/hooks/useLocalImport";

// Moves the boards saved in this browser to the account before the board is loaded, so they show up at once
// and no empty first board is created beside them. Inside the AuthGate: the user is signed in.
export function LocalImport({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { state, settled, retry, dismiss } = useLocalImport({ email: user?.email ?? "" });

  if (!settled) return null;
  return (
    <>
      <div className="px-4 pt-4 empty:hidden sm:px-6">
        <ImportBanner state={state} onRetry={() => void retry().then(refreshBoards)} onDismiss={dismiss} />
      </div>
      {children}
    </>
  );
}
