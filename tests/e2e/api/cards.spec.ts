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

type CardJson = { id: string; listId: string; title: string; position: number };
type ListJson = { id: string; name: string; cards: CardJson[] };

test.describe("cards API", () => {
  let a: APIRequestContext;
  let b: APIRequestContext;
  const boards: string[] = [];

  // A fresh board with two lists, so the tests don't depend on (or disturb) A's other boards.
  const freshBoard = async () => {
    const board = await (await a.post("api/boards", { data: { name: unique() } })).json();
    boards.push(board.id);
    const one = await (await a.post(`api/boards/${board.id}/lists`, { data: { name: "One" } })).json();
    const two = await (await a.post(`api/boards/${board.id}/lists`, { data: { name: "Two" } })).json();
    return { boardId: board.id as string, one: one.id as string, two: two.id as string };
  };
  const addCard = async (listId: string, title: string): Promise<CardJson> => {
    const res = await a.post(`api/lists/${listId}/cards`, { data: { title } });
    expect(res.status()).toBe(201);
    return res.json();
  };
  const layout = async (boardId: string) =>
    ((await (await a.get(`api/boards/${boardId}`)).json()).lists as ListJson[]).map((l) =>
      l.cards.map((c) => [c.title, c.position]),
    );

  test.beforeAll(async ({ baseURL }) => {
    const url = baseURL ?? "http://localhost:3000/";
    a = await signIn(url, "a@example.test");
    b = await signIn(url, "b@example.test");
  });

  test.afterAll(async () => {
    for (const id of boards) await a.delete(`api/boards/${id}`);
    await a.dispose();
    await b.dispose();
  });

  test("requires a session", async ({ request }) => {
    expect((await request.post("api/lists/x/cards", { data: { title: "t" } })).status()).toBe(401);
    expect((await request.get("api/cards/x")).status()).toBe(401);
    expect((await request.patch("api/cards/x", { data: { title: "t" } })).status()).toBe(401);
    expect((await request.post("api/cards/x/move", { data: { listId: "l", position: 0 } })).status()).toBe(401);
    expect((await request.delete("api/cards/x")).status()).toBe(401);
  });

  test("A creates, reads, updates, moves and deletes cards", async () => {
    const { boardId, one, two } = await freshBoard();
    const first = await addCard(one, "  First  ");
    expect(first).toMatchObject({ title: "First", position: 0, listId: one });
    const second = await addCard(one, "Second");
    const third = await addCard(one, "Third");
    expect(third.position).toBe(2);

    const created = await a.post(`api/lists/${one}/cards`, {
      data: { title: "Full", priority: "high", cover: "teal", dueDate: "2026-12-31", notes: "  note  " },
    });
    expect(created.status()).toBe(201);
    expect(await created.json()).toMatchObject({ priority: "high", cover: "teal", dueDate: "2026-12-31", notes: "note", position: 3 });

    const updated = await a.patch(`api/cards/${first.id}`, { data: { title: "Renamed", cover: "red", notes: null } });
    expect(updated.status()).toBe(200);
    expect(await updated.json()).toMatchObject({ title: "Renamed", cover: "red", notes: null });
    expect((await (await a.get(`api/cards/${first.id}`)).json()).title).toBe("Renamed");

    // Within a list, then across lists.
    expect((await a.post(`api/cards/${third.id}/move`, { data: { listId: one, position: 0 } })).status()).toBe(200);
    expect((await a.post(`api/cards/${second.id}/move`, { data: { listId: two, position: 0 } })).status()).toBe(200);
    expect(await layout(boardId)).toEqual([
      [["Third", 0], ["Renamed", 1], ["Full", 2]],
      [["Second", 0]],
    ]);

    expect((await a.delete(`api/cards/${third.id}`)).status()).toBe(204);
    expect((await a.get(`api/cards/${third.id}`)).status()).toBe(404);
    expect(await layout(boardId)).toEqual([[["Renamed", 0], ["Full", 1]], [["Second", 0]]]);
  });

  test("archive, restore and ticking a checklist item are recorded in the card's activity", async () => {
    const { boardId, one } = await freshBoard();
    const card = await addCard(one, "Tracked");
    const activityTypes = (json: { activity: { type: string }[] }) => json.activity.map((entry) => entry.type);

    const withItem = await (await a.post(`api/cards/${card.id}/checklist`, { data: { text: "Step" } })).json();
    const ticked = await a.patch(`api/cards/${card.id}/checklist/${withItem.checklist[0].id}`, { data: { done: true } });
    expect(ticked.status()).toBe(200);
    const tickedJson = await ticked.json();
    expect(tickedJson.activity[0]).toMatchObject({ type: "checklistDone", to: "Step" });
    // Un-ticking records nothing.
    const unticked = await (
      await a.patch(`api/cards/${card.id}/checklist/${withItem.checklist[0].id}`, { data: { done: false } })
    ).json();
    expect(activityTypes(unticked)).toEqual(["checklistDone", "created"]);

    expect((await a.post(`api/cards/${card.id}/archive`)).status()).toBe(200);
    const archived = await (await a.get(`api/boards/${boardId}/archive`)).json();
    expect(activityTypes(archived[0])).toEqual(["archived", "checklistDone", "created"]);

    const restored = await a.post(`api/archive/${card.id}/restore`, { data: {} });
    expect(restored.status()).toBe(200);
    expect(activityTypes(await restored.json())).toEqual(["restored", "archived", "checklistDone", "created"]);
  });

  test("archiving a list and the done list records one archived entry per card", async () => {
    const { boardId, one } = await freshBoard();
    const done = await (await a.post(`api/boards/${boardId}/lists`, { data: { name: "Done" } })).json();
    await addCard(one, "L1");
    await addCard(one, "L2");
    await addCard(done.id, "D1");
    await addCard(done.id, "D2");
    const types = (cards: { activity: { type: string }[] }[]) => cards.map((card) => card.activity.map((e) => e.type));

    const byList = await a.post(`api/lists/${one}/archive`);
    expect(byList.status()).toBe(200);
    expect(types(await byList.json())).toEqual([["archived", "created"], ["archived", "created"]]);

    const byDone = await a.post(`api/boards/${boardId}/archive/done`);
    expect(byDone.status()).toBe(200);
    expect(types(await byDone.json())).toEqual([["archived", "created"], ["archived", "created"]]);
  });

  test("invalid input returns 400", async () => {
    const { one } = await freshBoard();
    const card = await addCard(one, "ok");
    for (const data of [
      { title: "   " },
      { title: "x".repeat(121) },
      { title: "t", notes: "n".repeat(1001) },
      { title: "t", priority: "urgent" },
      { title: "t", cover: "black" },
      { title: "t", dueDate: "2026-02-30" },
      { title: "t", dueDate: "2026-1-1" },
    ]) {
      expect((await a.post(`api/lists/${one}/cards`, { data })).status()).toBe(400);
    }
    expect((await a.patch(`api/cards/${card.id}`, { data: { title: "" } })).status()).toBe(400);
    expect((await a.post(`api/cards/${card.id}/move`, { data: { listId: one, position: -1 } })).status()).toBe(400);
  });

  test("a list on another board is rejected and nothing changes", async () => {
    const mine = await freshBoard();
    const other = await freshBoard();
    const card = await addCard(mine.one, "Stay");
    expect((await a.post(`api/cards/${card.id}/move`, { data: { listId: other.one, position: 0 } })).status()).toBe(404);
    expect(await layout(mine.boardId)).toEqual([[["Stay", 0]], []]);
    expect(await layout(other.boardId)).toEqual([[], []]);
  });

  test("B gets 404 for A's list and card on every route, and A's data is unchanged", async () => {
    const { boardId, one, two } = await freshBoard();
    const card = await addCard(one, "Mine");

    expect((await b.post(`api/lists/${one}/cards`, { data: { title: "Stolen" } })).status()).toBe(404);
    expect((await b.get(`api/cards/${card.id}`)).status()).toBe(404);
    expect((await b.patch(`api/cards/${card.id}`, { data: { title: "Stolen" } })).status()).toBe(404);
    expect((await b.post(`api/cards/${card.id}/move`, { data: { listId: two, position: 0 } })).status()).toBe(404);
    expect((await b.delete(`api/cards/${card.id}`)).status()).toBe(404);

    expect(await layout(boardId)).toEqual([[["Mine", 0]], []]);
  });
});
