import { INTERNAL_API_KEY_HEADER } from "@adt/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/healthz/route";

const health = { status: "ok", commit: "abc", database: "ok" };

beforeEach(() => {
  vi.stubEnv("API_URL", "http://api.test");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("GET /healthz", () => {
  it("sends the internal key to the API's /health", async () => {
    vi.stubEnv("INTERNAL_API_KEY", "server-key");
    const fetchMock = vi.fn(async () => Response.json(health));
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET();

    expect(response.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://api.test/health");
    expect(new Headers(init.headers).get(INTERNAL_API_KEY_HEADER)).toBe("server-key");
  });

  it("fails with 503 in production without a key, and does not call the API", async () => {
    vi.stubEnv("INTERNAL_API_KEY", "");
    vi.stubEnv("NODE_ENV", "production");
    const fetchMock = vi.fn(async () => Response.json(health));
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET();

    expect(response.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
