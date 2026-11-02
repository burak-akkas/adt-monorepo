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
let seq = 0;
const email = (name: string) => `${name}-${run}@labels-http-spec.test`;

describe("labels over HTTP", () => {
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
    post: (path: string, body: object = {}) => request(app.getHttpServer()).post(path).set("Cookie", cookie).send(body),
    delete: (path: string) => request(app.getHttpServer()).delete(path).set("Cookie", cookie),
  });
  const newCard = async (cookie: string): Promise<string> => {
    const a = as(cookie);
    const board = (await a.post("/boards", { name: `B${seq++}` }).expect(201)).body.id as string;
    const list = (await a.post(`/boards/${board}/lists`, { name: "L" }).expect(201)).body.id as string;
    return (await a.post(`/lists/${list}/cards`, { title: "Card" }).expect(201)).body.id as string;
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
    await prisma.user.deleteMany({ where: { email: { endsWith: `-${run}@labels-http-spec.test` } } });
    await app.close();
  });

  it("answers 401 on every route without a session", async () => {
    const server = () => request(app.getHttpServer());
    await server().post("/cards/abc/labels").send({ name: "x" }).expect(401);
    await server().delete("/cards/abc/labels/x").expect(401);
  });

  it("adds trimmed labels in order, answers 409 for a duplicate and removes ignoring case", async () => {
    const a = as(cookieA);
    const cardId = await newCard(cookieA);
    const first = (await a.post(`/cards/${cardId}/labels`, { name: "  Bug " }).expect(201)).body;
    expect(cardResponseSchema.parse(first).labels).toEqual(["Bug"]);
    await a.post(`/cards/${cardId}/labels`, { name: "Front End" }).expect(201);
    await a.post(`/cards/${cardId}/labels`, { name: "bUG" }).expect(409);

    const removed = (await a.delete(`/cards/${cardId}/labels/${encodeURIComponent("  bug ")}`).expect(200)).body;
    expect(removed.labels).toEqual(["Front End"]);
    expect((await a.delete(`/cards/${cardId}/labels/nope`).expect(200)).body.labels).toEqual(["Front End"]);
  });

  it("validates the name with 400", async () => {
    const a = as(cookieA);
    const cardId = await newCard(cookieA);
    await a.post(`/cards/${cardId}/labels`, { name: "   " }).expect(400);
    await a.post(`/cards/${cardId}/labels`, {}).expect(400);
    await a.post(`/cards/${cardId}/labels`, { name: "x".repeat(21) }).expect(400);
    await a.post(`/cards/${cardId}/labels`, { name: "x".repeat(20) }).expect(201);
  });

  it("gives another user's card a 404", async () => {
    const cardId = await newCard(cookieA);
    await as(cookieA).post(`/cards/${cardId}/labels`, { name: "mine" }).expect(201);
    const b = as(cookieB);
    await b.post(`/cards/${cardId}/labels`, { name: "x" }).expect(404);
    await b.delete(`/cards/${cardId}/labels/mine`).expect(404);
    expect(await prisma.cardLabel.count({ where: { cardId } })).toBe(1);
  });
});
