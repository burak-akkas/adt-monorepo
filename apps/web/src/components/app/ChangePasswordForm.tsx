"use client";

import { useState, type FormEvent } from "react";

import { Button, Input } from "@/components/ui";
import { authClient } from "@/lib/auth-client";
import { GENERIC_ERROR, accountErrorMessage, validateChangePasswordForm } from "@/lib/authErrors";

export const PASSWORD_CHANGED_MESSAGE = "Password changed. Other devices have been logged out.";

export function ChangePasswordForm() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSuccess(false);
    const invalid = validateChangePasswordForm({ currentPassword, newPassword });
    if (invalid) {
      setError(invalid);
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const { error: apiError } = await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      });
      if (apiError) {
        setError(accountErrorMessage(apiError));
        return;
      }
      setCurrentPassword("");
      setNewPassword("");
      setSuccess(true);
    } catch {
      setError(GENERIC_ERROR);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate aria-labelledby="change-password-heading" className="flex w-full max-w-sm flex-col gap-4">
      <h2 id="change-password-heading" className="text-lg font-semibold">
        Change password
      </h2>
      <div className="flex flex-col gap-1">
        <label htmlFor="current-password" className="text-sm font-medium">
          Current password
        </label>
        <Input
          id="current-password"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="new-password" className="text-sm font-medium">
          New password
        </label>
        <Input
          id="new-password"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger dark:text-danger">
          {error}
        </p>
      )}
      {success && (
        <p role="status" className="text-sm text-green-700 dark:text-green-400">
          {PASSWORD_CHANGED_MESSAGE}
        </p>
      )}
      <Button type="submit" variant="primary" loading={submitting}>
        Change password
      </Button>
    </form>
  );
}
