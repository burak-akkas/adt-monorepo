import { expect, test } from "../../support/fixtures";

// Smoke test of the shared fixtures: each test has its own account, and seeded data belongs to that account only.
test.describe.configure({ mode: "parallel" });

for (const label of ["first", "second"]) {
  test(`${label} test gets its own signed-in user and board`, async ({ api, user, seedBoard }) => {
    const session = await api.get("api/auth/get-session");
    expect((await session.json()).user.email).toBe(user.email);

    const board = await seedBoard({
      name: `Board of ${label}`,
      lists: [{ id: "a", name: "Only list", cards: [{ title: "Seeded card" }] }],
    });
    expect(board.name).toBe(`Board of ${label}`);

    const list = await api.get("api/boards");
    const boards = (await list.json()) as { id: string; name: string }[];
    expect(boards.map((b) => b.name)).toEqual([`Board of ${label}`]);
  });
}

test("a board seeded for one user is not reachable by another", async ({ api, seedBoard, baseURL, playwright }) => {
  const board = await seedBoard();
  expect((await api.get(`api/boards/${board.id}`)).status()).toBe(200);

  const url = baseURL ?? "http://localhost:3000/";
  const other = await playwright.request.newContext({ baseURL: url, extraHTTPHeaders: { origin: new URL(url).origin } });
  const email = `e2e-other-${Date.now().toString(36)}@example.test`;
  const signUp = await other.post("api/auth/sign-up/email", { data: { name: email, email, password: "test-password-123" } });
  expect(signUp.ok()).toBe(true);
  expect((await other.get(`api/boards/${board.id}`)).status()).toBe(404);
  await other.dispose();
});
