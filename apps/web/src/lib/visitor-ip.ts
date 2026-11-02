/** Headers that carry a client address. The proxy removes all of them before forwarding, so the API sees only x-visitor-ip. */
export const FORWARDING_HEADERS = ["x-forwarded-for", "x-real-ip", "x-vercel-forwarded-for"] as const;

const first = (value: string | null): string | null => value?.split(",")[0]?.trim() || null;

/**
 * The visitor's address as the platform reports it. On Vercel, x-vercel-forwarded-for and x-real-ip are set by
 * Vercel's edge and overwrite whatever the client sent. The first x-forwarded-for entry is only a fallback for
 * running without Vercel (local, CI, QA), where there is no edge to overwrite it.
 */
export function readVisitorIp(headers: Headers): string | null {
  return (
    first(headers.get("x-vercel-forwarded-for")) ?? first(headers.get("x-real-ip")) ?? first(headers.get("x-forwarded-for"))
  );
}
