import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiError, apiRequest, importBoard, inviteMember, listMembers, removeMember } from "@/lib/api-client";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function stubFetch(response: Response | Error) {
  const fetchMock = vi.fn(async () => {
    if (!(response instanceof Response)) {
      throw response;
    }
    return response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe("apiRequest", () => {
  it("calls /api/... on its own origin with a relative URL", async () => {
    const fetchMock = stubFetch(json({ ok: true }));
    await apiRequest("/boards", { schema: z.object({ ok: z.boolean() }) });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/boards");
    expect(init.credentials).toBe("same-origin");
    expect(init.method).toBe("GET");
  });

  it("sends a JSON body", async () => {
    const fetchMock = stubFetch(json({ ok: true }));
    await apiRequest("/boards", { method: "POST", body: { name: "x" } });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.body).toBe('{"name":"x"}');
    expect(init.headers).toEqual({ "content-type": "application/json" });
  });

  it.each(["https://api.example.test/boards", "//evil.test/boards", "boards", "/x?u=http://evil.test"])("rejects the path %s", async (path) => {
    const fetchMock = stubFetch(json({}));
    await expect(apiRequest(path)).rejects.toThrow(/path like/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [400, "validation"],
    [422, "validation"],
    [401, "unauthorized"],
    [403, "forbidden"],
    [404, "not-found"],
    [409, "conflict"],
    [429, "rate-limited"],
    [500, "server"],
    [503, "server"],
  ])("maps status %i to %s", async (status, kind) => {
    stubFetch(json({ message: "nope" }, status));
    const error = await apiRequest("/boards").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ kind, status, message: "nope" });
  });

  it("dispatches adt:unauthorized on a 401 only, and still throws", async () => {
    const listener = vi.fn();
    window.addEventListener("adt:unauthorized", listener);
    try {
      stubFetch(json({}, 403));
      await apiRequest("/boards").catch(() => undefined);
      expect(listener).not.toHaveBeenCalled();
      stubFetch(json({}, 401));
      await expect(apiRequest("/boards")).rejects.toBeInstanceOf(ApiError);
      expect(listener).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("adt:unauthorized", listener);
    }
  });

  it("uses a generic message when the error has no message", async () => {
    stubFetch(new Response("<html>", { status: 502 }));
    const error = await apiRequest("/boards").catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: "server", status: 502 });
    expect((error as ApiError).message).not.toBe("");
  });

  it("maps a failed fetch to a network error", async () => {
    stubFetch(new TypeError("Failed to fetch"));
    await expect(apiRequest("/boards")).rejects.toMatchObject({ kind: "network", status: 0 });
  });

  it("rethrows an abort unchanged", async () => {
    const abort = new DOMException("aborted", "AbortError");
    stubFetch(abort);
    await expect(apiRequest("/boards")).rejects.toBe(abort);
  });

  it("maps a body that fails the schema to invalid-response", async () => {
    stubFetch(json({ ok: "yes" }));
    await expect(apiRequest("/boards", { schema: z.object({ ok: z.boolean() }) })).rejects.toMatchObject({ kind: "invalid-response", status: 200 });
  });

  it("maps a body that is not JSON to invalid-response", async () => {
    stubFetch(new Response("nope", { status: 200 }));
    await expect(apiRequest("/boards", { schema: z.object({}) })).rejects.toMatchObject({ kind: "invalid-response" });
  });

  it("returns undefined for 204", async () => {
    stubFetch(new Response(null, { status: 204 }));
    await expect(apiRequest("/boards/1", { method: "DELETE", schema: z.object({}) })).resolves.toBeUndefined();
  });
});

describe("importBoard", () => {
  it("posts to /api/boards/import", async () => {
    const fetchMock = stubFetch(json({ nope: true }));
    await expect(importBoard({ importKey: crypto.randomUUID(), name: "x", lists: [] })).rejects.toMatchObject({ kind: "invalid-response" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/boards/import");
    expect(init.method).toBe("POST");
  });
});

describe("members calls", () => {
  it("lists the owner and the members", async () => {
    const body = { owner: { email: "o@example.test" }, members: [{ id: "m1", email: "x@example.test" }] };
    const fetchMock = stubFetch(json(body));
    await expect(listMembers("b 1")).resolves.toEqual(body);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/boards/b%201/members");
    expect(init.method).toBe("GET");
  });

  it("rejects a list in an unexpected shape", async () => {
    stubFetch(json({ nope: true }));
    await expect(listMembers("b1")).rejects.toMatchObject({ kind: "invalid-response" });
  });

  it("invites by email", async () => {
    const fetchMock = stubFetch(json({ id: "m1", email: "x@example.test" }, 201));
    await expect(inviteMember("b1", "x@example.test")).resolves.toEqual({ id: "m1", email: "x@example.test" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/boards/b1/members");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ email: "x@example.test" }));
  });

  it("maps 400 and 409 on invite", async () => {
    stubFetch(json({ message: "You already own this board" }, 400));
    await expect(inviteMember("b1", "o@example.test")).rejects.toMatchObject({ kind: "validation", message: "You already own this board" });
    stubFetch(json({ message: "Already invited" }, 409));
    await expect(inviteMember("b1", "x@example.test")).rejects.toMatchObject({ kind: "conflict", message: "Already invited" });
  });

  it("removes a member", async () => {
    const fetchMock = stubFetch(new Response(null, { status: 204 }));
    await expect(removeMember("b1", "m 1")).resolves.toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/boards/b1/members/m%201");
    expect(init.method).toBe("DELETE");
  });

  it("maps 404 on remove", async () => {
    stubFetch(json({ message: "Member not found" }, 404));
    await expect(removeMember("b1", "m1")).rejects.toMatchObject({ kind: "not-found" });
  });
});
