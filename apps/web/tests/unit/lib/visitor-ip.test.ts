import { describe, expect, it } from "vitest";
import { readVisitorIp } from "@/lib/visitor-ip";

const ip = (headers: Record<string, string>) => readVisitorIp(new Headers(headers));

describe("readVisitorIp", () => {
  it("prefers x-vercel-forwarded-for, then x-real-ip, then x-forwarded-for", () => {
    const all = { "x-vercel-forwarded-for": "1.1.1.1", "x-real-ip": "2.2.2.2", "x-forwarded-for": "3.3.3.3" };
    expect(ip(all)).toBe("1.1.1.1");
    expect(ip({ "x-real-ip": "2.2.2.2", "x-forwarded-for": "3.3.3.3" })).toBe("2.2.2.2");
    expect(ip({ "x-forwarded-for": "3.3.3.3" })).toBe("3.3.3.3");
  });

  it("takes the first entry of a list", () => {
    expect(ip({ "x-forwarded-for": "3.3.3.3, 4.4.4.4" })).toBe("3.3.3.3");
  });

  it("returns null without any of them, and ignores x-visitor-ip", () => {
    expect(ip({})).toBeNull();
    expect(ip({ "x-visitor-ip": "6.6.6.6" })).toBeNull();
    expect(ip({ "x-forwarded-for": " " })).toBeNull();
  });
});
