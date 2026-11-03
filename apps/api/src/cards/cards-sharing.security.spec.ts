import { Test } from "@nestjs/testing";
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { AppModule } from "../app.module.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { mountAuth } from "../auth/auth.module.js";

// Runs against the real local Postgres, with real sessions.
// Owner A, editor B (invited by email, case-insensitively) and non-member C, on every endpoint of the cards,
// checklist and comments controllers. A non-member always gets 404, never 403.
process.env.DATABASE_URL ??= "postgresql://kanban:kanban@localhost:5432/kanban";
const ORIGIN = "http://localhost:3000";
const PASSWORD = "a-good-password-1";
const run = Math.random().toString(36).slice(2, 8);
const DOMAIN = "cards-sharing-spec.test";
const email = (name: string) => `${name}-${run}@${DOMAIN}`;

describe("sharing: cards, checklist and comments", () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const cookies: Record<"a" | "b" | "c", string> = { a: "", b: "", c: "" };

  const signUp = async (name: string) => {
    const res = await request(app.getHttpServer())
      .post("/auth/sign-up/email")
      .set("Origin", ORIGIN)
      .send({ name, email: email(name), password: PASSWORD })
      .expect(200);
    return (res.headers["set-cookie"] as unknown as string[]).map((c) => c.split(";")[0]).join("; ");
  };
  const as = (who: "a" | "b" | "c") => {
    const cookie = cookies[who];
    const server = () => request(app.getHttpServer());
    return {
      get: (path: string) => server().get(path).set("Cookie", cookie),
      post: (path: string, body: object = {}) => server().post(path).set("Cookie", cookie).send(body),
      patch: (path: string, body: object) => server().patch(path).set("Cookie", cookie).send(body),
      put: (path: string, body: object) => server().put(path).set("Cookie", cookie).send(body),
      delete: (path: string) => server().delete(path).set("Cookie", cookie),
    };
  };

  /** Owner A's board with two lists and one card (a checklist item and a comment), B invited as editor. */
  const shared = async () => {
    const a = as("a");
    const boardId = (await a.post("/boards", { name: "Shared" }).expect(201)).body.id as string;
    // Invite with different casing: access is matched lower-cased.
    await a.post(`/boards/${boardId}/members`, { email: email("bo").toUpperCase() }).expect(201);
    const todo = (await a.post(`/boards/${boardId}/lists`, { name: "Todo" }).expect(201)).body.id as string;
    const doing = (await a.post(`/boards/${boardId}/lists`, { name: "Doing" }).expect(201)).body.id as string;
    const card = (await a.post(`/lists/${todo}/cards`, { title: "Task" }).expect(201)).body.id as string;
    const withItem = (await a.post(`/cards/${card}/checklist`, { text: "step" }).expect(201)).body;
    const withComment = (await a.post(`/cards/${card}/comments`, { text: "hello" }).expect(201)).body;
    return { boardId, todo, doing, card, itemId: withItem.checklist[0].id as string, commentId: withComment.comments[0].id as string };
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
    mountAuth(app);
    await app.init();
    prisma = app.get(PrismaService);
    cookies.a = await signUp("ann");
    cookies.b = await signUp("bo");
    cookies.c = await signUp("cy");
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { endsWith: `-${run}@${DOMAIN}` } } });
    await app.close();
  });

  describe("cards", () => {
    it("lets owner A and editor B read, create, edit, move, duplicate and delete", async () => {
      const s = await shared();
      for (const who of ["a", "b"] as const) {
        const u = as(who);
        await u.get(`/cards/${s.card}`).expect(200);
        const created = (await u.post(`/lists/${s.todo}/cards`, { title: `By ${who}` }).expect(201)).body;
        expect((await u.patch(`/cards/${created.id}`, { title: `Edited by ${who}` }).expect(200)).body.title).toBe(`Edited by ${who}`);
        expect((await u.post(`/cards/${created.id}/move`, { listId: s.doing, position: 0 }).expect(200)).body.listId).toBe(s.doing);
        const copy = (await u.post(`/cards/${created.id}/duplicate`).expect(201)).body;
        expect(copy.title).toBe(`Edited by ${who} (copy)`);
        await u.delete(`/cards/${copy.id}`).expect(204);
        await u.delete(`/cards/${created.id}`).expect(204);
      }
    });

    it("gives non-member C a 404 on every endpoint and changes nothing", async () => {
      const s = await shared();
      const c = as("c");
      await c.get(`/cards/${s.card}`).expect(404);
      await c.post(`/lists/${s.todo}/cards`, { title: "Stolen" }).expect(404);
      await c.patch(`/cards/${s.card}`, { title: "Stolen" }).expect(404);
      await c.post(`/cards/${s.card}/move`, { listId: s.doing, position: 0 }).expect(404);
      await c.post(`/cards/${s.card}/duplicate`).expect(404);
      await c.delete(`/cards/${s.card}`).expect(404);

      const card = (await as("a").get(`/cards/${s.card}`).expect(200)).body;
      expect(card).toMatchObject({ title: "Task", listId: s.todo });
      expect(await prisma.card.count({ where: { list: { boardId: s.boardId } } })).toBe(1);
    });

    it("refuses to move a card onto a list of a board the user cannot access", async () => {
      const s = await shared();
      const cBoard = (await as("c").post("/boards", { name: "Cy's" }).expect(201)).body.id as string;
      const cList = (await as("c").post(`/boards/${cBoard}/lists`, { name: "L" }).expect(201)).body.id as string;
      // Editor B and owner A can see the card, but not C's list.
      await as("b").post(`/cards/${s.card}/move`, { listId: cList, position: 0 }).expect(404);
      await as("a").post(`/cards/${s.card}/move`, { listId: cList, position: 0 }).expect(404);
      // And C cannot move a card onto A's list, nor create there.
      const cCard = (await as("c").post(`/lists/${cList}/cards`, { title: "mine" }).expect(201)).body.id as string;
      await as("c").post(`/cards/${cCard}/move`, { listId: s.todo, position: 0 }).expect(404);
      expect((await as("a").get(`/cards/${s.card}`).expect(200)).body.listId).toBe(s.todo);
      expect((await as("c").get(`/cards/${cCard}`).expect(200)).body.listId).toBe(cList);
    });

    it("stops editor B from reaching the card once removed from the board", async () => {
      const s = await shared();
      const members = (await as("a").get(`/boards/${s.boardId}/members`).expect(200)).body.members as { id: string }[];
      await as("a").delete(`/boards/${s.boardId}/members/${members[0].id}`).expect(204);
      await as("b").get(`/cards/${s.card}`).expect(404);
      await as("b").patch(`/cards/${s.card}`, { title: "x" }).expect(404);
    });
  });

  describe("checklist", () => {
    it("lets owner A and editor B add, tick, rename, reorder and remove items", async () => {
      const s = await shared();
      for (const who of ["a", "b"] as const) {
        const u = as(who);
        const added = (await u.post(`/cards/${s.card}/checklist`, { text: `by ${who}` }).expect(201)).body;
        const mine = added.checklist.find((i: { text: string }) => i.text === `by ${who}`).id as string;
        expect((await u.patch(`/cards/${s.card}/checklist/${mine}`, { done: true, text: `done ${who}` }).expect(200)).body.checklist).toEqual(
          expect.arrayContaining([expect.objectContaining({ id: mine, text: `done ${who}`, done: true })]),
        );
        const ids = (await as("a").get(`/cards/${s.card}`).expect(200)).body.checklist.map((i: { id: string }) => i.id) as string[];
        await u.put(`/cards/${s.card}/checklist/order`, { itemIds: [...ids].reverse() }).expect(200);
        await u.delete(`/cards/${s.card}/checklist/${mine}`).expect(200);
      }
    });

    it("gives non-member C a 404 on every endpoint and changes nothing", async () => {
      const s = await shared();
      const c = as("c");
      await c.post(`/cards/${s.card}/checklist`, { text: "Stolen" }).expect(404);
      await c.put(`/cards/${s.card}/checklist/order`, { itemIds: [s.itemId] }).expect(404);
      await c.patch(`/cards/${s.card}/checklist/${s.itemId}`, { done: true, text: "Stolen" }).expect(404);
      await c.delete(`/cards/${s.card}/checklist/${s.itemId}`).expect(404);
      const card = (await as("a").get(`/cards/${s.card}`).expect(200)).body;
      expect(card.checklist).toMatchObject([{ id: s.itemId, text: "step", done: false }]);
    });
  });

  describe("comments", () => {
    it("lets owner A and editor B add, edit and delete comments", async () => {
      const s = await shared();
      for (const who of ["a", "b"] as const) {
        const u = as(who);
        const added = (await u.post(`/cards/${s.card}/comments`, { text: `by ${who}` }).expect(201)).body;
        const mine = added.comments.find((i: { text: string }) => i.text === `by ${who}`).id as string;
        expect((await u.patch(`/cards/${s.card}/comments/${mine}`, { text: `edited ${who}` }).expect(200)).body.comments).toEqual(
          expect.arrayContaining([expect.objectContaining({ id: mine, text: `edited ${who}` })]),
        );
        await u.delete(`/cards/${s.card}/comments/${mine}`).expect(200);
      }
    });

    it("gives non-member C a 404 on every endpoint and changes nothing", async () => {
      const s = await shared();
      const c = as("c");
      await c.post(`/cards/${s.card}/comments`, { text: "Stolen" }).expect(404);
      await c.patch(`/cards/${s.card}/comments/${s.commentId}`, { text: "Stolen" }).expect(404);
      await c.delete(`/cards/${s.card}/comments/${s.commentId}`).expect(404);
      const card = (await as("a").get(`/cards/${s.card}`).expect(200)).body;
      expect(card.comments).toMatchObject([{ id: s.commentId, text: "hello", editedAt: null }]);
    });
  });

  it("never touches another user's cards: C's own board stays private to C", async () => {
    const s = await shared();
    const cBoard = (await as("c").post("/boards", { name: "Private" }).expect(201)).body.id as string;
    const cList = (await as("c").post(`/boards/${cBoard}/lists`, { name: "L" }).expect(201)).body.id as string;
    const cCard = (await as("c").post(`/lists/${cList}/cards`, { title: "secret" }).expect(201)).body.id as string;
    for (const who of ["a", "b"] as const) {
      const u = as(who);
      await u.get(`/cards/${cCard}`).expect(404);
      await u.patch(`/cards/${cCard}`, { title: "x" }).expect(404);
      await u.post(`/cards/${cCard}/checklist`, { text: "x" }).expect(404);
      await u.post(`/cards/${cCard}/comments`, { text: "x" }).expect(404);
      await u.delete(`/cards/${cCard}`).expect(404);
    }
    expect((await as("c").get(`/cards/${cCard}`).expect(200)).body).toMatchObject({ title: "secret", checklist: [], comments: [] });
    expect((await as("a").get(`/cards/${s.card}`).expect(200)).body.title).toBe("Task");
  });
});
