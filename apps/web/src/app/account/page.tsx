"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { ChangePasswordForm } from "@/components/app/ChangePasswordForm";
import { DeleteAccountSection } from "@/components/app/DeleteAccountSection";
import { Spinner } from "@/components/ui";
import { useAuth } from "@/hooks/useAuth";

export default function AccountPage() {
  const router = useRouter();
  const { status, user } = useAuth();

  useEffect(() => {
    if (status === "anonymous") router.replace("/login");
  }, [status, router]);

  if (status !== "authenticated") {
    return (
      <main className="mx-auto flex min-h-screen max-w-sm items-center justify-center px-4 py-12 text-subtle">
        {status === "loading" && <Spinner size="lg" label="Loading" />}
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col gap-8 px-4 py-12">
      <Link href="/" className="text-sm text-subtle underline">
        Back to board
      </Link>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Account</h1>
        <p className="text-sm text-subtle">
          Signed in as <span className="font-medium text-foreground">{user.email}</span>
        </p>
      </div>
      <ChangePasswordForm />
      <DeleteAccountSection />
    </main>
  );
}
