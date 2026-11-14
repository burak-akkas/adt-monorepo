import { Test } from "@nestjs/testing";
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { AppModule } from "../app.module.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { mountAuth } from "../auth/auth.module.js";

// Runs against the real local Postgres, with real sessions.
// Owner A, member B and outsider C. An outsider, or a user on another board, always gets 404 and changes nothing.
process.env.DATABASE_URL ??= "postgresql://kanban:kanban@localhost:5432/kanban";
const ORIGIN = "http://localhost:3000";
const PASSWORD = "a-good-password-1";
const run = Math.random().toString(36).slice(2, 8);
const DOMAIN = "assignees-sharing-spec.test";
const email = (name: string) => `${name}-${run}@${DOMAIN}`;

describe("sharing: assignees", () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const cookies: Record<"a" | "b" | "c", string> = { a: "", b: "", c: "" };
  let boards = 0;

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
      delete: (path: string) => server().delete(path).set("Cookie", cookie),
    };
  };
  const assign = (cardId: string) => `/cards/${cardId}/assignees`;

  /** Owner A's board with one card, B invited as a member. */
  const shared = async () => {
    const a = as("a");
    const boardId = (await a.post("/boards", { name: `Shared ${++boards}` }).expect(201)).body.id as string;
    await a.post(`/boards/${boardId}/members`, { email: email("bo") }).expect(201);
    const list = (await a.post(`/boards/${boardId}/lists`, { name: "Todo" }).expect(201)).body.id as string;
    const card = (await a.post(`/lists/${list}/cards`, { title: "Task" }).expect(201)).body.id as string;
    return { boardId, card };
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

  it("lets owner A and member B assign and unassign both people", async () => {
    const s = await shared();
    for (const who of ["a", "b"] as const) {
      const u = as(who);
      for (const person of [email("ann"), email("bo")]) {
        expect((await u.post(assign(s.card), { email: person }).expect(201)).body.assignees).toContain(person);
        expect((await u.delete(`${assign(s.card)}/${encodeURIComponent(person)}`).expect(200)).body.assignees).not.toContain(person);
      }
    }
  });

  it("refuses to assign a person who is not on the board, even to an outsider's own address", async () => {
    const s = await shared();
    await as("a").post(assign(s.card), { email: email("cy") }).expect(400);
    await as("b").post(assign(s.card), { email: email("cy") }).expect(400);
    expect(await prisma.cardAssignee.count({ where: { cardId: s.card } })).toBe(0);
  });

  it("gives outsider C a 404 on both endpoints and changes nothing", async () => {
    const s = await shared();
    await as("a").post(assign(s.card), { email: email("bo") }).expect(201);
    const c = as("c");
    await c.post(assign(s.card), { email: email("cy") }).expect(404);
    await c.post(assign(s.card), { email: email("ann") }).expect(404);
    await c.delete(`${assign(s.card)}/${encodeURIComponent(email("bo"))}`).expect(404);
    expect((await as("a").get(`/cards/${s.card}`).expect(200)).body.assignees).toEqual([email("bo")]);
    expect(await prisma.cardActivity.count({ where: { cardId: s.card, type: { in: ["assigned", "unassigned"] } } })).toBe(1);
  });

  it("gives a user on another board a 404, even when they own a board of their own", async () => {
    const s = await shared();
    const cBoard = (await as("c").post("/boards", { name: "Cy's" }).expect(201)).body.id as string;
    const cList = (await as("c").post(`/boards/${cBoard}/lists`, { name: "L" }).expect(201)).body.id as string;
    const cCard = (await as("c").post(`/lists/${cList}/cards`, { title: "mine" }).expect(201)).body.id as string;
    for (const who of ["a", "b"] as const) {
      await as(who).post(assign(cCard), { email: email(who === "a" ? "ann" : "bo") }).expect(404);
    }
    await as("c").post(assign(s.card), { email: email("cy") }).expect(404);
    expect(await prisma.cardAssignee.count({ where: { cardId: { in: [cCard, s.card] } } })).toBe(0);
  });

  it("clears a removed member's assignments on that board only", async () => {
    const s = await shared();
    const other = await shared();
    await as("a").post(assign(s.card), { email: email("bo") }).expect(201);
    await as("a").post(assign(other.card), { email: email("bo") }).expect(201);
    const members = (await as("a").get(`/boards/${s.boardId}/members`).expect(200)).body.members as { id: string }[];
    await as("a").delete(`/boards/${s.boardId}/members/${members[0].id}`).expect(204);
    expect(await prisma.cardAssignee.count({ where: { cardId: s.card } })).toBe(0);
    expect(await prisma.cardAssignee.count({ where: { cardId: other.card } })).toBe(1);
  });
});
