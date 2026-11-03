"use client";

import Link from "next/link";

import { Button, Spinner } from "@/components/ui";
import { useAuth } from "@/hooks/useAuth";

const linkClass =
  "rounded-md px-3 py-1.5 text-sm text-subtle outline-none hover:bg-surface-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent";

export function AccountMenu() {
  const { status, user, logout } = useAuth();
  if (status === "loading") return <Spinner size="sm" label="Loading account" className="text-subtle" />;
  if (status === "anonymous") {
    return (
      <nav aria-label="Account" className="flex items-center gap-1">
        <Link href="/login" className={linkClass}>
          Log in
        </Link>
        <Link href="/register" className={linkClass}>
          Register
        </Link>
      </nav>
    );
  }
  return (
    <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
      <span className="hidden max-w-[12rem] min-w-0 truncate text-sm text-subtle sm:inline">{user.email}</span>
      <Link href="/account" className={linkClass}>
        Account
      </Link>
      <Button variant="secondary" size="sm" onClick={() => void logout()}>
        Log out
      </Button>
    </div>
  );
}
