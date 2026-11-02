import { randomUUID } from "node:crypto";
import { expect, request as playwrightRequest, test, type APIRequestContext } from "@playwright/test";

// The seeded accounts a@ and b@, signed in through the web origin (Next.js forwards /api/... to the API).
const PASSWORD = "test-password-123";
const AT = "2026-01-02T03:04:05.000Z";
const unique = () => `e2e ${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

async function signIn(baseURL: string, email: string): Promise<APIRequestContext> {
  const origin = new URL(baseURL).origin;
  const context = await playwrightRequest.newContext({ baseURL, extraHTTPHeaders: { origin } });
  const res = await context.post("api/auth/sign-in/email", { data: { email, password: PASSWORD } });
  expect(res.ok()).toBe(true);
  return context;
}

const snapshot = (importKey: string, name: string) => ({
  importKey,
  name,
  lists: [
    {
      id: "c-todo",
      name: "To do",
      wipLimit: 3,
      collapsed: true,
      cards: [
        {
          title: "First",
          priority: "high",
          cover: "blue",
          dueDate: "2026-05-06",
          notes: "notes",
          createdAt: AT,
          checklist: [{ text: "step", done: true }],
          comments: [{ text: "hi", createdAt: AT }],
          labels: ["bug"],
          activity: [{ type: "moved", at: AT, from: "c-todo", to: "c-done" }],
        },
        { title: "Second" },
      ],
    },
    { id: "c-done", name: "Done" },
  ],
  archive: [{ title: "Archived", archivedAt: AT }],
  templates: [{ name: "Bug", title: "Bug: " }],
  settings: { background: { type: "color", value: "#445566" }, view: "calendar", doingListId: "c-todo", doneListId: "c-done" },
});

test.describe("board import API", () => {
  let a: APIRequestContext;
  let b: APIRequestContext;
  const created: { ctx: APIRequestContext; id: string }[] = [];

  const track = (ctx: APIRequestContext, id: string) => created.push({ ctx, id });

  test.beforeAll(async ({ baseURL }) => {
    const url = baseURL ?? "http://localhost:3000/";
    a = await signIn(url, "a@example.test");
    b = await signIn(url, "b@example.test");
  });

  test.afterAll(async () => {
    for (const { ctx, id } of created) await ctx.delete(`api/boards/${id}`);
    await a.dispose();
    await b.dispose();
  });

  test("requires a session", async ({ request }) => {
    expect((await request.post("api/boards/import", { data: snapshot(randomUUID(), "x") })).status()).toBe(401);
    expect((await request.put("api/lists/x/cards/order", { data: { cardIds: [] } })).status()).toBe(401);
    expect((await request.post("api/lists/x/archive")).status()).toBe(401);
  });

  test("imports a whole board once and returns it again for the same key", async () => {
    const key = randomUUID();
    const name = unique();
    const first = await a.post("api/boards/import", { data: snapshot(key, name) });
    expect(first.status()).toBe(201);
    const { board, created: wasCreated } = await first.json();
    track(a, board.id);
    expect(wasCreated).toBe(true);
    expect(board.name).toBe(name);
    const [todo, done] = board.lists;
    expect(todo).toMatchObject({ name: "To do", wipLimit: 3, collapsed: true });
    expect(todo.cards[0]).toMatchObject({ title: "First", priority: "high", dueDate: "2026-05-06", labels: ["bug"] });
    expect(todo.cards[0].activity[0]).toMatchObject({ type: "moved", from: todo.id, to: done.id });
    expect(board.archive).toHaveLength(1);
    expect(board.templates).toHaveLength(1);
    expect(board.settings).toMatchObject({ view: "calendar", doingListId: todo.id, doneListId: done.id });

    const again = await a.post("api/boards/import", { data: snapshot(key, name) });
    expect(again.status()).toBe(200);
    const body = await again.json();
    expect(body.created).toBe(false);
    expect(body.board.id).toBe(board.id);
    const boards = (await (await a.get("api/boards")).json()) as { id: string }[];
    expect(boards.filter((x) => x.id === board.id)).toHaveLength(1);
  });

  test("creates one board for parallel requests with the same key", async () => {
    const key = randomUUID();
    const name = unique();
    const responses = await Promise.all(Array.from({ length: 4 }, () => a.post("api/boards/import", { data: snapshot(key, name) })));
    const bodies = await Promise.all(responses.map((r) => r.json()));
    const ids = new Set(bodies.map((x) => x.board.id as string));
    for (const id of ids) track(a, id);
    expect(ids.size).toBe(1);
    expect(responses.filter((r) => r.status() === 201)).toHaveLength(1);
    expect(responses.filter((r) => r.status() === 200)).toHaveLength(3);
  });

  test("the same key from another user makes a separate board and exposes nothing", async () => {
    const key = randomUUID();
    const mine = await (await a.post("api/boards/import", { data: snapshot(key, unique()) })).json();
    track(a, mine.board.id);
    const res = await b.post("api/boards/import", { data: snapshot(key, unique()) });
    expect(res.status()).toBe(201);
    const theirs = await res.json();
    track(b, theirs.board.id);
    expect(theirs.board.id).not.toBe(mine.board.id);
    expect((await b.get(`api/boards/${mine.board.id}`)).status()).toBe(404);
  });

  test("rejects an invalid body with 400", async () => {
    expect((await a.post("api/boards/import", { data: { ...snapshot(randomUUID(), "x"), importKey: "nope" } })).status()).toBe(400);
    const badDate = snapshot(randomUUID(), "x");
    badDate.lists[0].cards[0].dueDate = "2026-02-30";
    expect((await a.post("api/boards/import", { data: badDate })).status()).toBe(400);
  });

  test("reorders a list's cards and archives a list, only for the owner", async () => {
    const board = (await (await a.post("api/boards/import", { data: snapshot(randomUUID(), unique()) })).json()).board;
    track(a, board.id);
    const list = board.lists[0];
    const [c1, c2] = list.cards as { id: string }[];

    expect((await b.put(`api/lists/${list.id}/cards/order`, { data: { cardIds: [c2.id, c1.id] } })).status()).toBe(404);
    expect((await b.post(`api/lists/${list.id}/archive`)).status()).toBe(404);
    expect((await a.put(`api/lists/${list.id}/cards/order`, { data: { cardIds: [c2.id] } })).status()).toBe(400);

    const reordered = await a.put(`api/lists/${list.id}/cards/order`, { data: { cardIds: [c2.id, c1.id] } });
    expect(reordered.status()).toBe(200);
    expect((await reordered.json()).map((c: { id: string }) => c.id)).toEqual([c2.id, c1.id]);

    const archived = await a.post(`api/lists/${list.id}/archive`);
    expect(archived.status()).toBe(200);
    expect((await archived.json()).map((c: { id: string }) => c.id)).toEqual([c2.id, c1.id]);
    const after = await (await a.get(`api/boards/${board.id}`)).json();
    expect(after.lists[0].cards).toEqual([]);
    expect(after.archive).toHaveLength(3);
  });
});
