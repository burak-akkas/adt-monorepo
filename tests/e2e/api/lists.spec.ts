import { expect, request as playwrightRequest, test, type APIRequestContext } from "@playwright/test";

// The seeded accounts a@ and b@, signed in through the web origin (Next.js forwards /api/... to the API).
const PASSWORD = "test-password-123";
const unique = () => `e2e ${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

async function signIn(baseURL: string, email: string): Promise<APIRequestContext> {
  const origin = new URL(baseURL).origin;
  const context = await playwrightRequest.newContext({ baseURL, extraHTTPHeaders: { origin } });
  const res = await context.post("api/auth/sign-in/email", { data: { email, password: PASSWORD } });
  expect(res.ok()).toBe(true);
  return context;
}

type Named = { id: string; name: string; position: number };

test.describe("lists API", () => {
  let a: APIRequestContext;
  let b: APIRequestContext;
  const created: string[] = [];

  const freshBoard = async () => {
    const board = await (await a.post("api/boards", { data: { name: unique() } })).json();
    created.push(board.id);
    return board.id as string;
  };
  const addList = async (boardId: string, name: string): Promise<Named> => {
    const res = await a.post(`api/boards/${boardId}/lists`, { data: { name } });
    expect(res.status()).toBe(201);
    return res.json();
  };
  const names = async (boardId: string) =>
    ((await (await a.get(`api/boards/${boardId}`)).json()).lists as Named[]).map((l) => [l.name, l.position]);

  test.beforeAll(async ({ baseURL }) => {
    const url = baseURL ?? "http://localhost:3000/";
    a = await signIn(url, "a@example.test");
    b = await signIn(url, "b@example.test");
  });

  test.afterAll(async () => {
    for (const id of created) await a.delete(`api/boards/${id}`);
    await a.dispose();
    await b.dispose();
  });

  test("requires a session", async ({ request }) => {
    expect((await request.post("api/boards/x/lists", { data: { name: "n" } })).status()).toBe(401);
    expect((await request.patch("api/lists/x", { data: { name: "n" } })).status()).toBe(401);
    expect((await request.post("api/lists/x/move", { data: { position: 0 } })).status()).toBe(401);
    expect((await request.delete("api/lists/x")).status()).toBe(401);
  });

  test("A adds, renames, reorders and deletes lists", async () => {
    const boardId = await freshBoard();
    const one = await addList(boardId, "  One  ");
    expect(one).toMatchObject({ name: "One", position: 0 });
    const two = await addList(boardId, "Two");
    const three = await addList(boardId, "Three");
    expect(three.position).toBe(2);

    expect((await a.post(`api/boards/${boardId}/lists`, { data: { name: "ONE" } })).status()).toBe(409);
    expect((await a.post(`api/boards/${boardId}/lists`, { data: { name: "   " } })).status()).toBe(400);
    expect((await a.post(`api/boards/${boardId}/lists`, { data: { name: "x".repeat(31) } })).status()).toBe(400);

    expect((await a.patch(`api/lists/${one.id}`, { data: { name: "ONE" } })).status()).toBe(200);
    expect((await a.patch(`api/lists/${one.id}`, { data: { name: "two" } })).status()).toBe(409);

    const moved = await a.post(`api/lists/${three.id}/move`, { data: { position: 0 } });
    expect(moved.status()).toBe(200);
    expect(await names(boardId)).toEqual([["Three", 0], ["ONE", 1], ["Two", 2]]);

    expect((await a.delete(`api/lists/${two.id}`)).status()).toBe(204);
    expect(await names(boardId)).toEqual([["Three", 0], ["ONE", 1]]);
    expect((await a.delete(`api/lists/${one.id}`)).status()).toBe(204);
    expect((await a.delete(`api/lists/${three.id}`)).status()).toBe(409);
  });

  test("an empty list deletes without a target, and moveTo is ignored", async () => {
    const boardId = await freshBoard();
    const first = await addList(boardId, "First");
    const second = await addList(boardId, "Second");
    // The cards API is not merged yet, so the card transfer is covered in lists.service.spec.ts.
    const otherBoard = await freshBoard();
    const foreign = await addList(otherBoard, "Elsewhere");
    expect((await a.delete(`api/lists/${first.id}?moveTo=${foreign.id}`)).status()).toBe(204);
    expect(await names(boardId)).toEqual([["Second", 0]]);
    expect(await names(otherBoard)).toEqual([["Elsewhere", 0]]);
    expect((await a.delete(`api/lists/${second.id}`)).status()).toBe(409);
  });

  test("B gets 404 for A's board and list on every route, and A's data is unchanged", async () => {
    const boardId = await freshBoard();
    const one = await addList(boardId, "Mine");
    const two = await addList(boardId, "Also mine");

    expect((await b.post(`api/boards/${boardId}/lists`, { data: { name: "Stolen" } })).status()).toBe(404);
    expect((await b.patch(`api/lists/${one.id}`, { data: { name: "Stolen" } })).status()).toBe(404);
    expect((await b.post(`api/lists/${one.id}/move`, { data: { position: 1 } })).status()).toBe(404);
    expect((await b.delete(`api/lists/${one.id}`)).status()).toBe(404);
    expect((await b.delete(`api/lists/${one.id}?moveTo=${two.id}`)).status()).toBe(404);

    expect(await names(boardId)).toEqual([["Mine", 0], ["Also mine", 1]]);
  });
});
