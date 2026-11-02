import { createHash, timingSafeEqual } from "node:crypto";
import { INTERNAL_API_KEY_HEADER } from "@adt/contracts";
import type { RequestHandler } from "express";

// Same value as the web app and tools/start-stack.sh use outside production.
const DEV_INTERNAL_API_KEY = "dev-only-internal-api-key-not-for-production";

export function readInternalApiKey(env: NodeJS.ProcessEnv = process.env): string {
  const production = env.NODE_ENV === "production";
  const key = env.INTERNAL_API_KEY || (production ? undefined : DEV_INTERNAL_API_KEY);
  if (!key) throw new Error("INTERNAL_API_KEY is required in production");
  return key;
}

const digest = (value: string) => createHash("sha256").update(value).digest();

/** Rejects every request that doesn't carry the internal key. Compares fixed-size SHA-256 digests, so the length of the key doesn't leak. */
export function internalApiKeyMiddleware(key: string): RequestHandler {
  const expected = digest(key);
  return (req, res, next) => {
    const header = req.headers[INTERNAL_API_KEY_HEADER];
    if (typeof header === "string" && header !== "" && timingSafeEqual(digest(header), expected)) {
      next();
      return;
    }
    res.status(401).json({ statusCode: 401, message: "Unauthorized" });
  };
}
