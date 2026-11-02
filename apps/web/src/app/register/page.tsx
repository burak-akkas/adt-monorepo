"use client";

import Link from "next/link";

import { AuthForm } from "@/components/app/AuthForm";

export default function RegisterPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col gap-6 px-4 py-12">
      <Link href="/" className="text-sm text-subtle underline">
        Back to board
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">Register</h1>
      <AuthForm mode="register" />
    </main>
  );
}
