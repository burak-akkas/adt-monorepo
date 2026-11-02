const SHORT_SHA_LENGTH = 7;

/** "Version 0.1.0 · a1b2c3d". Without a sha: "Version 0.1.0". Without a version: "". */
export function formatVersionLine(version: string | undefined, sha: string | undefined): string {
  const v = (version ?? "").trim();
  if (!v) return "";
  const short = (sha ?? "").trim().slice(0, SHORT_SHA_LENGTH);
  return short ? `Version ${v} · ${short}` : `Version ${v}`;
}
