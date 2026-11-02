"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button, Input } from "@/components/ui";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { authClient } from "@/lib/auth-client";
import { GENERIC_ERROR, accountErrorMessage, validateDeleteAccountForm } from "@/lib/authErrors";

export function DeleteAccountSection() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    const invalid = validateDeleteAccountForm({ password });
    if (invalid) {
      setError(invalid);
      return;
    }
    setError(null);
    setConfirming(true);
  }

  async function deleteAccount() {
    if (submitting) return;
    setConfirming(false);
    setSubmitting(true);
    try {
      const { error: apiError } = await authClient.deleteUser({ password });
      if (apiError) {
        setError(accountErrorMessage(apiError));
        return;
      }
      router.push("/");
    } catch {
      setError(GENERIC_ERROR);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section aria-labelledby="delete-account-heading" className="flex w-full max-w-sm flex-col gap-4">
      <h2 id="delete-account-heading" className="text-lg font-semibold">
        Delete account
      </h2>
      <p className="text-sm text-subtle">
        This permanently removes your account, your sessions and everything stored on the server for you. It cannot be
        undone. Boards saved in this browser stay here.
      </p>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="delete-password" className="text-sm font-medium">
            Password to confirm deletion
          </label>
          <Input
            id="delete-password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error && (
          <p role="alert" className="text-sm text-danger dark:text-danger">
            {error}
          </p>
        )}
        <Button type="submit" variant="secondary" className="text-danger dark:text-danger" disabled={submitting}>
          Delete account
        </Button>
      </form>
      {confirming && (
        <ConfirmDialog
          title="Delete your account?"
          message="This cannot be undone. Your account and its server data will be deleted for good."
          confirmLabel="Yes, delete my account"
          onConfirm={() => void deleteAccount()}
          onCancel={() => setConfirming(false)}
        />
      )}
    </section>
  );
}
