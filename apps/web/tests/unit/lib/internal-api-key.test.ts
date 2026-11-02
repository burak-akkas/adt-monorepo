import { describe, expect, it } from "vitest";
import { readInternalApiKey } from "@/lib/internal-api-key";

describe("readInternalApiKey", () => {
  it("falls back to the dev default outside production", () => {
    expect(readInternalApiKey({ NODE_ENV: "development" })).toBe("dev-only-internal-api-key-not-for-production");
    expect(readInternalApiKey({})).toBe("dev-only-internal-api-key-not-for-production");
  });

  it("uses the configured key when there is one", () => {
    expect(readInternalApiKey({ NODE_ENV: "production", INTERNAL_API_KEY: "real-key" })).toBe("real-key");
    expect(readInternalApiKey({ NODE_ENV: "development", INTERNAL_API_KEY: "other" })).toBe("other");
  });

  it("throws in production when the key is missing or empty", () => {
    expect(() => readInternalApiKey({ NODE_ENV: "production" })).toThrow();
    expect(() => readInternalApiKey({ NODE_ENV: "production", INTERNAL_API_KEY: "" })).toThrow();
  });
});
