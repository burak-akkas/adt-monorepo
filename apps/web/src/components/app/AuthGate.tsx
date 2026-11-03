"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { useAuth } from "@/hooks/useAuth";
import { UNAUTHORIZED_EVENT } from "@/lib/api-client";
import { USE_SERVER_BOARDS } from "@/lib/config";
import { loginUrlFor } from "@/lib/nextPath";

// Sends logged-out visitors to /login?next=... Does nothing while USE_SERVER_BOARDS is false.
export function AuthGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { status } = useAuth();

  useEffect(() => {
    if (!USE_SERVER_BOARDS) return;
    // Read the query string at redirect time, so the gate needs no Suspense boundary.
    const redirect = () => router.replace(loginUrlFor(pathname + window.location.search));
    if (status === "anonymous") redirect();
    window.addEventListener(UNAUTHORIZED_EVENT, redirect);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, redirect);
  }, [status, router, pathname]);

  if (!USE_SERVER_BOARDS) return <>{children}</>;
  return status === "authenticated" ? <>{children}</> : null;
}
