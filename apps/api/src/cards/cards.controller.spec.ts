import { Test } from "@nestjs/testing";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { cardResponseSchema } from "@adt/contracts";
import request from "supertest";
import { AppModule } from "../app.module.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { mountAuth } from "../auth/auth.module.js";

// Runs against the real local Postgres, with real sessions.
process.env.DATABASE_URL ??= "postgresql://kanban:kanban@localhost:5432/kanban";
const ORIGIN = "http://localhost:3000";
const PASSWORD = "a-good-password-1";
const run = Math.random().toString(36).slice(2, 8);
const email = (name: string) => `${name}-${run}@cards-http-spec.test`;

describe("cards over HTTP", () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let cookieA: string;
  let cookieB: string;

  const signUp = async (name: string) => {
    const res = await request(app.getHttpServer())
      .post("/auth/sign-up/email")
      .set("Origin", ORIGIN)
      .send({ name, email: email(name), password: PASSWORD })
      .expect(200);
    return (res.headers["set-cookie"] as unknown as string[]).map((c) => c.split(";")[0]).join("; ");
  };
  const as = (cookie: string) => ({
    get: (path: string) => request(app.getHttpServer()).get(path).set("Cookie", cookie),
    post: (path: string, body: object = {}) => request(app.getHttpServer()).post(path).set("Cookie", cookie).send(body),
    patch: (path: string, body: object) => request(app.getHttpServer()).patch(path).set("Cookie", cookie).send(body),
    delete: (path: string) => request(app.getHttpServer()).delete(path).set("Cookie", cookie),
  });
  const newList = async (cookie: string, name: string) => {
    const board = (await as(cookie).post("/boards", { name }).expect(201)).body.id as string;
    return (await as(cookie).post(`/boards/${board}/lists`, { name: "L" }).expect(201)).body.id as string;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
    mountAuth(app);
    await app.init();
    prisma = app.get(PrismaService);
    cookieA = await signUp("ann");
    cookieB = await signUp("bo");
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { endsWith: `-${run}@cards-http-spec.test` } } });
    await app.close();
  });

  it("answers 401 on every route without a session", async () => {
    const server = () => request(app.getHttpServer());
    await server().post("/lists/abc/cards").send({ title: "x" }).expect(401);
    await server().get("/cards/abc").expect(401);
    await server().patch("/cards/abc").send({ title: "x" }).expect(401);
    await server().post("/cards/abc/move").send({ listId: "l", position: 0 }).expect(401);
    await server().delete("/cards/abc").expect(401);
    await server().post("/cards/abc/duplicate").expect(401);
  });

  it("duplicates a card with 201 and gives another user a 404", async () => {
    const listId = await newList(cookieA, "Dup");
    const card = (await as(cookieA).post(`/lists/${listId}/cards`, { title: "Task", priority: "high" }).expect(201)).body;
    const res = await as(cookieA).post(`/cards/${card.id}/duplicate`).expect(201);
    expect(cardResponseSchema.parse(res.body)).toMatchObject({ title: "Task (copy)", priority: "high", position: 1, listId });
    await as(cookieB).post(`/cards/${card.id}/duplicate`).expect(404);
    await as(cookieA).post("/cards/does-not-exist/duplicate").expect(404);
  });

  it("creates, reads, updates, moves and deletes with the right status codes", async () => {
    const a = as(cookieA);
    const listId = await newList(cookieA, "Flow");
    const card = (await a.post(`/lists/${listId}/cards`, { title: "  Task  " }).expect(201)).body;
    expect(cardResponseSchema.parse(card)).toMatchObject({ title: "Task", priority: "medium", position: 0 });
    await a.get(`/cards/${card.id}`).expect(200);
    expect((await a.patch(`/cards/${card.id}`, { notes: "  hi  ", cover: "blue" }).expect(200)).body).toMatchObject({ notes: "hi", cover: "blue" });
    expect((await a.post(`/cards/${card.id}/move`, { listId, position: 5 }).expect(200)).body.position).toBe(0);
    await a.delete(`/cards/${card.id}`).expect(204);
    await a.get(`/cards/${card.id}`).expect(404);
  });

  it("validates input with 400", async () => {
    const a = as(cookieA);
    const listId = await newList(cookieA, "Validation");
    await a.post(`/lists/${listId}/cards`, { title: "   " }).expect(400);
    await a.post(`/lists/${listId}/cards`, { title: "x".repeat(121) }).expect(400);
    await a.post(`/lists/${listId}/cards`, { title: "x".repeat(120) }).expect(201);
    await a.post(`/lists/${listId}/cards`, { title: "t", notes: "n".repeat(1001) }).expect(400);
    await a.post(`/lists/${listId}/cards`, { title: "t", priority: "urgent" }).expect(400);
    await a.post(`/lists/${listId}/cards`, { title: "t", cover: "black" }).expect(400);
    await a.post(`/lists/${listId}/cards`, { title: "t", dueDate: "2026-02-30" }).expect(400);
    await a.post(`/lists/${listId}/cards`, { title: "t", dueDate: "2026-1-1" }).expect(400);
    const card = (await a.post(`/lists/${listId}/cards`, { title: "ok", dueDate: "2026-02-28" }).expect(201)).body;
    expect(card.dueDate).toBe("2026-02-28");
    await a.patch(`/cards/${card.id}`, { title: "" }).expect(400);
    await a.post(`/cards/${card.id}/move`, { listId, position: -1 }).expect(400);
    await a.post(`/cards/${card.id}/move`, { position: 0 }).expect(400);
  });

  it("gives another user's list and card the same 404 as a missing one", async () => {
    const listId = await newList(cookieA, "Foreign");
    const card = (await as(cookieA).post(`/lists/${listId}/cards`, { title: "Mine" }).expect(201)).body;
    const b = as(cookieB);
    await b.post(`/lists/${listId}/cards`, { title: "Stolen" }).expect(404);
    await b.get(`/cards/${card.id}`).expect(404);
    await b.patch(`/cards/${card.id}`, { title: "Stolen" }).expect(404);
    await b.post(`/cards/${card.id}/move`, { listId, position: 0 }).expect(404);
    await b.delete(`/cards/${card.id}`).expect(404);
    await b.get("/cards/does-not-exist").expect(404);
    expect((await as(cookieA).get(`/cards/${card.id}`).expect(200)).body.title).toBe("Mine");
  });
});
