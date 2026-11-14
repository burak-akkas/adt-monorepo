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
const DOMAIN = "assignees-http-spec.test";
const email = (name: string) => `${name}-${run}@${DOMAIN}`;

describe("assignees over HTTP", () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let cookieA: string;

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

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
    mountAuth(app);
    await app.init();
    prisma = app.get(PrismaService);
    cookieA = await signUp("ann");
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { endsWith: `-${run}@${DOMAIN}` } } });
    await app.close();
  });

  const newCard = async (): Promise<string> => {
    const a = as(cookieA);
    const board = (await a.post("/boards", { name: `B${seq++}` }).expect(201)).body.id as string;
    const list = (await a.post(`/boards/${board}/lists`, { name: "L" }).expect(201)).body.id as string;
    return (await a.post(`/lists/${list}/cards`, { title: "Card" }).expect(201)).body.id as string;
  };

  it("answers 401 on every route without a session", async () => {
    const server = () => request(app.getHttpServer());
    await server().post("/cards/abc/assignees").send({ email: "a@example.test" }).expect(401);
    await server().delete("/cards/abc/assignees/a@example.test").expect(401);
  });

  it("validates the email with 400", async () => {
    const a = as(cookieA);
    const cardId = await newCard();
    await a.post(`/cards/${cardId}/assignees`, {}).expect(400);
    await a.post(`/cards/${cardId}/assignees`, { email: "not-an-email" }).expect(400);
  });

  it("assigns the owner with a lower-cased email and unassigns", async () => {
    const a = as(cookieA);
    const cardId = await newCard();
    const added = (await a.post(`/cards/${cardId}/assignees`, { email: ` ${email("ann").toUpperCase()} ` }).expect(201)).body;
    expect(cardResponseSchema.parse(added).assignees).toEqual([email("ann")]);
    const removed = (await a.delete(`/cards/${cardId}/assignees/${encodeURIComponent(email("ann"))}`).expect(200)).body;
    expect(removed.assignees).toEqual([]);
  });

  it("answers 400 for someone outside the board", async () => {
    const cardId = await newCard();
    await as(cookieA).post(`/cards/${cardId}/assignees`, { email: "stranger@example.test" }).expect(400);
    expect(await prisma.cardAssignee.count({ where: { cardId } })).toBe(0);
  });
});
