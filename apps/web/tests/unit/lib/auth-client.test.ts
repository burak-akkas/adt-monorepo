import { describe, expect, it } from "vitest";
import { AUTH_BASE_PATH } from "@/lib/auth-client";

describe("auth client", () => {
  it("calls /api/auth on its own origin", () => {
    expect(AUTH_BASE_PATH).toBe("/api/auth");
  });
});
