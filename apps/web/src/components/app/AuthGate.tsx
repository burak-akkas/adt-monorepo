"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { useAuth } from "@/hooks/useAuth";
import { UNAUTHORIZED_EVENT } from "@/lib/api-client";
import { loginUrlFor } from "@/lib/nextPath";

// Sends logged-out visitors to /login?next=...
export function AuthGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { status } = useAuth();

  useEffect(() => {
    // Read the query string at redirect time, so the gate needs no Suspense boundary.
    const redirect = () => router.replace(loginUrlFor(pathname + window.location.search));
    if (status === "anonymous") redirect();
    window.addEventListener(UNAUTHORIZED_EVENT, redirect);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, redirect);
  }, [status, router, pathname]);

  return status === "authenticated" ? <>{children}</> : null;
}
