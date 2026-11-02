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
const email = (name: string) => `${name}-${run}@comments-http-spec.test`;

describe("comments over HTTP", () => {
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
    patch: (path: string, body: object) => request(app.getHttpServer()).patch(path).set("Cookie", cookie).send(body),
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
    await prisma.user.deleteMany({ where: { email: { endsWith: `-${run}@comments-http-spec.test` } } });
    await app.close();
  });

  it("answers 401 on every route without a session", async () => {
    const server = () => request(app.getHttpServer());
    await server().post("/cards/abc/comments").send({ text: "x" }).expect(401);
    await server().patch("/cards/abc/comments/def").send({ text: "x" }).expect(401);
    await server().delete("/cards/abc/comments/def").expect(401);
  });

  it("adds, edits and deletes with the right status codes and trims text", async () => {
    const a = as(cookieA);
    const cardId = await newCard(cookieA);
    const added = (await a.post(`/cards/${cardId}/comments`, { text: "  hello  " }).expect(201)).body;
    expect(cardResponseSchema.parse(added).comments).toMatchObject([{ text: "hello", editedAt: null }]);
    const id = added.comments[0].id as string;

    const unchanged = (await a.patch(`/cards/${cardId}/comments/${id}`, { text: " hello " }).expect(200)).body;
    expect(unchanged.comments[0].editedAt).toBeNull();
    const edited = (await a.patch(`/cards/${cardId}/comments/${id}`, { text: "bye" }).expect(200)).body;
    expect(edited.comments[0]).toMatchObject({ text: "bye" });
    expect(edited.comments[0].editedAt).not.toBeNull();

    expect((await a.delete(`/cards/${cardId}/comments/${id}`).expect(200)).body.comments).toEqual([]);
  });

  it("validates text with 400", async () => {
    const a = as(cookieA);
    const cardId = await newCard(cookieA);
    await a.post(`/cards/${cardId}/comments`, { text: "   " }).expect(400);
    await a.post(`/cards/${cardId}/comments`, {}).expect(400);
    await a.post(`/cards/${cardId}/comments`, { text: "x".repeat(1001) }).expect(400);
    const added = (await a.post(`/cards/${cardId}/comments`, { text: "x".repeat(1000) }).expect(201)).body;
    const id = added.comments[0].id as string;
    await a.patch(`/cards/${cardId}/comments/${id}`, { text: "" }).expect(400);
    await a.patch(`/cards/${cardId}/comments/${id}`, { text: "x".repeat(1001) }).expect(400);
  });

  it("gives another user's card or comment, and a comment id of another card, a 404", async () => {
    const cardId = await newCard(cookieA);
    const otherCardId = await newCard(cookieA);
    const commentId = (await as(cookieA).post(`/cards/${cardId}/comments`, { text: "mine" }).expect(201)).body.comments[0].id as string;
    const b = as(cookieB);
    await b.post(`/cards/${cardId}/comments`, { text: "x" }).expect(404);
    await b.patch(`/cards/${cardId}/comments/${commentId}`, { text: "x" }).expect(404);
    await b.delete(`/cards/${cardId}/comments/${commentId}`).expect(404);
    await as(cookieA).patch(`/cards/${otherCardId}/comments/${commentId}`, { text: "x" }).expect(404);
    await as(cookieA).delete(`/cards/${otherCardId}/comments/${commentId}`).expect(404);
    expect(await prisma.cardComment.findUnique({ where: { id: commentId } })).toMatchObject({ text: "mine", editedAt: null });
  });
});
