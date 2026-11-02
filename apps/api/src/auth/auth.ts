import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@adt/contracts";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import type { PrismaClient } from "../generated/prisma/client.js";

const DEV_URL = "http://localhost:3000";
const DEV_SECRET = "dev-only-secret-not-for-production-use-0123456789";

/** BETTER_AUTH_URL is the web origin: the browser calls /api/auth/... there and Next.js forwards it to /auth/... here. */
export function readAuthConfig(env: NodeJS.ProcessEnv = process.env): { baseURL: string; secret: string } {
  const production = env.NODE_ENV === "production";
  const baseURL = env.BETTER_AUTH_URL || (production ? undefined : DEV_URL);
  const secret = env.BETTER_AUTH_SECRET || (production ? undefined : DEV_SECRET);
  if (!baseURL) throw new Error("BETTER_AUTH_URL is required in production");
  if (!secret) throw new Error("BETTER_AUTH_SECRET is required in production");
  return { baseURL, secret };
}

export function createAuth(prisma: PrismaClient, env: NodeJS.ProcessEnv = process.env) {
  const { baseURL, secret } = readAuthConfig(env);
  return betterAuth({
    database: prismaAdapter(prisma, { provider: "postgresql" }),
    basePath: "/auth",
    baseURL,
    secret,
    trustedOrigins: [new URL(baseURL).origin],
    emailAndPassword: {
      enabled: true,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
      autoSignIn: true,
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
