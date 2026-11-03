// Accepts only a same-origin path: one leading "/", then not "/" or "\". Anything else becomes "/".
export function safeNextPath(raw: string | null | undefined): string {
  if (typeof raw !== "string" || !raw.startsWith("/")) return "/";
  if (raw.startsWith("//") || raw.startsWith("/\\")) return "/";
  if (raw.includes("\\") || raw.includes("://")) return "/";
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(raw)) return "/";
  return raw;
}

export function loginUrlFor(path: string): string {
  return `/login?next=${encodeURIComponent(safeNextPath(path))}`;
}
