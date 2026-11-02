"use client";

import { authUserSchema, type AuthUser } from "@adt/contracts";

import { authClient } from "@/lib/auth-client";

export type AuthState =
  | { status: "loading"; user: null; logout: () => Promise<void> }
  | { status: "anonymous"; user: null; logout: () => Promise<void> }
  | { status: "authenticated"; user: AuthUser; logout: () => Promise<void> };

async function logout() {
  try {
    await authClient.signOut();
  } catch {
    // A failed sign-out call leaves the session store as it is.
  }
}

export function useAuth(): AuthState {
  const { data, isPending, error } = authClient.useSession();
  if (isPending) return { status: "loading", user: null, logout };
  if (error) return { status: "anonymous", user: null, logout };
  const parsed = authUserSchema.safeParse(data?.user);
  if (!parsed.success) return { status: "anonymous", user: null, logout };
  return { status: "authenticated", user: parsed.data, logout };
}
