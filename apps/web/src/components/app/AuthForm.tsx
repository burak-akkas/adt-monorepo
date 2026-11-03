"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button, Input } from "@/components/ui";
import { authClient } from "@/lib/auth-client";
import { GENERIC_ERROR, authErrorMessage, validateAuthForm, type AuthMode } from "@/lib/authErrors";
import { safeNextPath } from "@/lib/nextPath";

export function AuthForm({ mode }: { mode: AuthMode }) {
  const router = useRouter();
  const next = useSearchParams().get("next");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const isRegister = mode === "register";
  const safeNext = safeNextPath(next);
  const linkSuffix = safeNext !== "/" ? `?next=${encodeURIComponent(safeNext)}` : "";

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    const invalid = validateAuthForm(mode, { email, password });
    if (invalid) {
      setError(invalid);
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const trimmed = email.trim().toLowerCase();
      let retryAfter: string | null = null;
      const fetchOptions = {
        onError: (ctx: { response: Response }) => {
          retryAfter = ctx.response.headers.get("x-retry-after") ?? ctx.response.headers.get("retry-after");
        },
      };
      const { error: apiError } = isRegister
        ? await authClient.signUp.email({ email: trimmed, password, name: trimmed }, fetchOptions)
        : await authClient.signIn.email({ email: trimmed, password }, fetchOptions);
      if (apiError) {
        setError(authErrorMessage(mode, apiError, retryAfter));
        return;
      }
      router.push(safeNext);
    } catch {
      setError(GENERIC_ERROR);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex w-full max-w-sm flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor={`${mode}-email`} className="text-sm font-medium">
          Email
        </label>
        <Input
          id={`${mode}-email`}
          name="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${mode}-password`} className="text-sm font-medium">
          Password
        </label>
        <Input
          id={`${mode}-password`}
          name="password"
          type="password"
          autoComplete={isRegister ? "new-password" : "current-password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger dark:text-danger">
          {error}
        </p>
      )}
      <Button type="submit" variant="primary" loading={submitting}>
        {isRegister ? "Register" : "Log in"}
      </Button>
      <p className="text-sm text-subtle">
        {isRegister ? "Already have an account? " : "No account yet? "}
        <Link href={`${isRegister ? "/login" : "/register"}${linkSuffix}`} className="underline">
          {isRegister ? "Log in" : "Register"}
        </Link>
      </p>
    </form>
  );
}
