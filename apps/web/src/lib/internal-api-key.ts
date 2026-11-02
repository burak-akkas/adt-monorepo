// Outside production, a fixed key lets local runs, CI and QA work without any setup.
const DEV_INTERNAL_API_KEY = "dev-only-internal-api-key-not-for-production";

type Env = Record<string, string | undefined>;

// Read at runtime on every call (never at build time), so the key stays out of the build output.
export function readInternalApiKey(env: Env = process.env): string {
  const key = env.INTERNAL_API_KEY;
  if (key) return key;
  if (env.NODE_ENV === "production") throw new Error("INTERNAL_API_KEY is not set");
  return DEV_INTERNAL_API_KEY;
}
