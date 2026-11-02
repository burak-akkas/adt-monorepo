import { INTERNAL_API_KEY_HEADER } from "@adt/contracts";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { config, proxy } from "@/proxy";

afterEach(() => vi.unstubAllEnvs());

const forwardedHeader = (response: Response, name: string) =>
  response.headers.get(`x-middleware-request-${name}`);

describe("proxy", () => {
  it("runs on /api/* only", () => {
    expect(config.matcher).toEqual(["/api/:path*"]);
  });

  it("adds the server-side key to the forwarded request", () => {
    vi.stubEnv("INTERNAL_API_KEY", "server-key");
    const response = proxy(new NextRequest("http://localhost/api/cards"));
    expect(response.status).toBe(200);
    expect(forwardedHeader(response, INTERNAL_API_KEY_HEADER)).toBe("server-key");
  });

  it("replaces a key sent by the browser", () => {
    vi.stubEnv("INTERNAL_API_KEY", "server-key");
    const request = new NextRequest("http://localhost/api/cards", {
      headers: { [INTERNAL_API_KEY_HEADER]: "bogus-browser-key" },
    });
    const response = proxy(request);
    expect(forwardedHeader(response, INTERNAL_API_KEY_HEADER)).toBe("server-key");
    expect(JSON.stringify([...response.headers])).not.toContain("bogus-browser-key");
  });

  it("keeps the other headers, such as cookies", () => {
    const request = new NextRequest("http://localhost/api/auth/get-session", { headers: { cookie: "a=b" } });
    expect(forwardedHeader(proxy(request), "cookie")).toBe("a=b");
  });

  it("uses the dev default outside production", () => {
    vi.stubEnv("INTERNAL_API_KEY", "");
    vi.stubEnv("NODE_ENV", "development");
    const response = proxy(new NextRequest("http://localhost/api/cards"));
    expect(forwardedHeader(response, INTERNAL_API_KEY_HEADER)).toBe("dev-only-internal-api-key-not-for-production");
  });

  it("answers 503 and does not forward in production without a key", () => {
    vi.stubEnv("INTERNAL_API_KEY", "");
    vi.stubEnv("NODE_ENV", "production");
    const response = proxy(new NextRequest("http://localhost/api/cards"));
    expect(response.status).toBe(503);
    expect(response.headers.get("x-middleware-next")).toBeNull();
  });
});
