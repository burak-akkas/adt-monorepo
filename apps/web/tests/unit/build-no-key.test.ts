// @vitest-environment node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const STATIC_DIR = join(process.cwd(), ".next", "static");
const DEV_KEY = "dev-only-internal-api-key-not-for-production";

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });

// Needs a build first (npm run build -w apps/web); without one it skips instead of passing silently.
describe.skipIf(!existsSync(STATIC_DIR))("built client bundle", () => {
  it("does not contain the internal API key", () => {
    const keys = [DEV_KEY, process.env.INTERNAL_API_KEY].filter((key): key is string => Boolean(key));
    const leaks = files(STATIC_DIR).filter((file) => {
      const content = readFileSync(file, "utf8");
      return keys.some((key) => content.includes(key));
    });
    expect(leaks).toEqual([]);
  });
});

if (!existsSync(STATIC_DIR)) console.warn("build-no-key: no .next/static, run `npm run build -w apps/web` first. Skipped.");
