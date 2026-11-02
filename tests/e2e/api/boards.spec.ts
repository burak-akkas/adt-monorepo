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

test.describe("boards API", () => {
  let a: APIRequestContext;
  let b: APIRequestContext;
  const created: string[] = [];

  test.beforeAll(async ({ baseURL }) => {
    const url = baseURL ?? "http://localhost:3000/";
    a = await signIn(url, "a@example.test");
    b = await signIn(url, "b@example.test");
  });

  test.afterAll(async () => {
    // Boards made by the tests are removed again; the last board of an account cannot be deleted, which is fine.
    for (const id of created) await a.delete(`api/boards/${id}`);
    await a.dispose();
    await b.dispose();
  });

  test("requires a session", async ({ request }) => {
    expect((await request.get("api/boards")).status()).toBe(401);
    expect((await request.post("api/boards", { data: { name: unique() } })).status()).toBe(401);
  });

  test("a new account gets one default board with To do, Doing and Done", async ({ baseURL }) => {
    const url = baseURL ?? "http://localhost:3000/";
    const fresh = await playwrightRequest.newContext({ baseURL: url, extraHTTPHeaders: { origin: new URL(url).origin } });
    const email = `e2e-boards-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
    const signUp = await fresh.post("api/auth/sign-up/email", { data: { name: "Fresh", email, password: PASSWORD } });
    expect(signUp.ok()).toBe(true);

    const list = await (await fresh.get("api/boards")).json();
    expect(list.map((x: { name: string }) => x.name)).toEqual(["My board"]);
    expect(await (await fresh.get("api/boards")).json()).toHaveLength(1);
    const board = await (await fresh.get(`api/boards/${list[0].id}`)).json();
    expect(board.lists.map((l: { name: string }) => l.name)).toEqual(["To do", "Doing", "Done"]);
    expect((await fresh.delete(`api/boards/${list[0].id}`)).status()).toBe(409);
    await fresh.dispose();
  });

  test("A creates, reads, renames, duplicates and deletes a board", async () => {
    const name = unique();
    const createRes = await a.post("api/boards", { data: { name: `  ${name}  ` } });
    expect(createRes.status()).toBe(201);
    const board = await createRes.json();
    created.push(board.id);
    expect(board.name).toBe(name);

    expect((await a.post("api/boards", { data: { name: name.toUpperCase() } })).status()).toBe(409);
    expect((await a.post("api/boards", { data: { name: "   " } })).status()).toBe(400);
    expect((await a.post("api/boards", { data: { name: "x".repeat(41) } })).status()).toBe(400);

    const read = await a.get(`api/boards/${board.id}`);
    expect(read.status()).toBe(200);
    expect((await read.json()).lists).toEqual([]);

    const renamed = unique();
    const renameRes = await a.patch(`api/boards/${board.id}`, { data: { name: renamed } });
    expect((await renameRes.json()).name).toBe(renamed);

    const copyRes = await a.post(`api/boards/${board.id}/duplicate`);
    expect(copyRes.status()).toBe(201);
    const copy = await copyRes.json();
    created.push(copy.id);
    expect(copy.name).toBe(`${renamed} (copy)`);

    expect((await a.delete(`api/boards/${copy.id}`)).status()).toBe(204);
    expect((await a.get(`api/boards/${copy.id}`)).status()).toBe(404);
  });

  test("B gets 404 for A's board on every route, and A's board is unchanged", async () => {
    const name = unique();
    const board = await (await a.post("api/boards", { data: { name } })).json();
    created.push(board.id);

    const missing = await b.get("api/boards/does-not-exist");
    expect(missing.status()).toBe(404);
    const foreign = await b.get(`api/boards/${board.id}`);
    expect(foreign.status()).toBe(404);
    expect(await foreign.json()).toEqual(await missing.json());
    expect((await b.patch(`api/boards/${board.id}`, { data: { name: unique() } })).status()).toBe(404);
    expect((await b.post(`api/boards/${board.id}/duplicate`)).status()).toBe(404);
    expect((await b.delete(`api/boards/${board.id}`)).status()).toBe(404);

    const bBoards = await (await b.get("api/boards")).json();
    expect(bBoards.map((x: { id: string }) => x.id)).not.toContain(board.id);
    const after = await (await a.get(`api/boards/${board.id}`)).json();
    expect(after.name).toBe(name);
    const aBoards = await (await a.get("api/boards")).json();
    expect(aBoards.some((x: { id: string }) => x.id === board.id)).toBe(true);
  });
});
