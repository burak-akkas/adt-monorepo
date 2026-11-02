import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, VISITOR_IP_HEADER } from "@adt/contracts";
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

export type RateLimitConfig = { window: number; max: number; signInMax: number };

function positiveInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

/** Strict defaults (5 sign-in/sign-up attempts and 100 other auth requests per 60 s per visitor). E2E and QA raise them by env; production sets nothing. */
export function readRateLimitConfig(env: NodeJS.ProcessEnv = process.env): RateLimitConfig {
  return {
    window: positiveInt(env, "AUTH_RATE_LIMIT_WINDOW_SECONDS", 60),
    max: positiveInt(env, "AUTH_RATE_LIMIT_MAX", 100),
    signInMax: positiveInt(env, "AUTH_RATE_LIMIT_SIGN_IN_MAX", 5),
  };
}

export function createAuth(prisma: PrismaClient, env: NodeJS.ProcessEnv = process.env) {
  const { baseURL, secret } = readAuthConfig(env);
  const limits = readRateLimitConfig(env);
  const strict = { window: limits.window, max: limits.signInMax };
  return betterAuth({
    database: prismaAdapter(prisma, { provider: "postgresql" }),
    basePath: "/auth",
    baseURL,
    secret,
    trustedOrigins: [new URL(baseURL).origin],
    // Only the web app can reach this API (internal key), and it sets this header itself, so it is the one source of the visitor's IP.
    advanced: { ipAddress: { ipAddressHeaders: [VISITOR_IP_HEADER] } },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: limits.window,
      max: limits.max,
      // Better Auth has its own tight default for /change-password (3 per 10 s), which would also trip the e2e suite; it gets the same configurable rule.
      customRules: { "/sign-in/email": strict, "/sign-up/email": strict, "/change-password": strict },
    },
    // With a password in the request, Better Auth skips the session-freshness check.
    user: { deleteUser: { enabled: true } },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
      autoSignIn: true,
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
