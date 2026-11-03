import { describe, expect, it } from "vitest";

import { loginUrlFor, safeNextPath } from "@/lib/nextPath";

describe("safeNextPath", () => {
  it.each(["/", "/?board=x", "/a/b", "/a?b=c#d"])("accepts %s", (path) => {
    expect(safeNextPath(path)).toBe(path);
  });

  it.each([
    "//evil.com",
    "https://evil.com",
    "/\\evil",
    "/a\\b",
    "javascript:alert(1)",
    "/x?u=http://evil.com",
    "/a\nb",
    "/a\tb",
    "evil",
    "",
    null,
    undefined,
  ])("rejects %s", (path) => {
    expect(safeNextPath(path)).toBe("/");
  });
});

describe("loginUrlFor", () => {
  it("encodes the path", () => {
    expect(loginUrlFor("/?board=x")).toBe("/login?next=%2F%3Fboard%3Dx");
  });

  it("falls back to / for an unsafe path", () => {
    expect(loginUrlFor("//evil.com")).toBe("/login?next=%2F");
  });
});
