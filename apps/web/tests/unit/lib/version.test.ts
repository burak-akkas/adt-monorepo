import { describe, expect, it } from "vitest";
import { formatVersionLine } from "@/lib/version";

describe("formatVersionLine", () => {
  it("shows version and short sha", () => {
    expect(formatVersionLine("0.1.0", "a1b2c3d")).toBe("Version 0.1.0 · a1b2c3d");
  });

  it("truncates a long sha to 7 characters", () => {
    expect(formatVersionLine("0.1.0", "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678")).toBe("Version 0.1.0 · a1b2c3d");
  });

  it("omits the separator when the sha is missing or blank", () => {
    expect(formatVersionLine("0.1.0", undefined)).toBe("Version 0.1.0");
    expect(formatVersionLine("0.1.0", "")).toBe("Version 0.1.0");
    expect(formatVersionLine("0.1.0", "   ")).toBe("Version 0.1.0");
  });

  it("returns an empty string when the version is missing", () => {
    expect(formatVersionLine(undefined, "a1b2c3d")).toBe("");
    expect(formatVersionLine("", "a1b2c3d")).toBe("");
  });

  it("never contains undefined", () => {
    expect(formatVersionLine("0.1.0", undefined)).not.toContain("undefined");
  });
});
