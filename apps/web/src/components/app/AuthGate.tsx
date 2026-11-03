"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { useAuth } from "@/hooks/useAuth";
import { UNAUTHORIZED_EVENT } from "@/lib/api-client";
import { authClient } from "@/lib/auth-client";
import { loginUrlFor } from "@/lib/nextPath";

// Sends logged-out visitors to /login?next=...
export function AuthGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { status } = useAuth();

  useEffect(() => {
    // Read the query string at redirect time, so the gate needs no Suspense boundary.
    const redirect = () => router.replace(loginUrlFor(pathname + window.location.search));
    let cancelled = false;
    if (status === "anonymous") {
      // Right after logging in, the shared session may not have caught up yet: ask the server before sending anyone away.
      authClient
        .getSession()
        .then(({ data }) => {
          if (cancelled) return;
          if (data?.user) authClient.$store.notify("$sessionSignal");
          else redirect();
        })
        .catch(() => {
          if (!cancelled) redirect();
        });
    }
    window.addEventListener(UNAUTHORIZED_EVENT, redirect);
    return () => {
      cancelled = true;
      window.removeEventListener(UNAUTHORIZED_EVENT, redirect);
    };
  }, [status, router, pathname]);

  return status === "authenticated" ? <>{children}</> : null;
}
