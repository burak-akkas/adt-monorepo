import { Test } from "@nestjs/testing";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { listResponseSchema } from "@adt/contracts";
import request from "supertest";
import { AppModule } from "../app.module.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { mountAuth } from "../auth/auth.module.js";

// Runs against the real local Postgres, with real sessions.
process.env.DATABASE_URL ??= "postgresql://kanban:kanban@localhost:5432/kanban";
const ORIGIN = "http://localhost:3000";
const PASSWORD = "a-good-password-1";
const run = Math.random().toString(36).slice(2, 8);
const email = (name: string) => `${name}-${run}@lists-http-spec.test`;

describe("lists over HTTP", () => {
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
  const newBoard = async (cookie: string, name: string) => (await as(cookie).post("/boards", { name }).expect(201)).body.id as string;

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
    await prisma.user.deleteMany({ where: { email: { endsWith: `-${run}@lists-http-spec.test` } } });
    await app.close();
  });

  it("answers 401 on every route without a session", async () => {
    const server = () => request(app.getHttpServer());
    await server().post("/boards/abc/lists").send({ name: "x" }).expect(401);
    await server().patch("/lists/abc").send({ name: "x" }).expect(401);
    await server().post("/lists/abc/move").send({ position: 0 }).expect(401);
    await server().delete("/lists/abc").expect(401);
  });

  it("adds, renames, moves and deletes lists with the right status codes", async () => {
    const a = as(cookieA);
    const boardId = await newBoard(cookieA, "Flow");
    const one = (await a.post(`/boards/${boardId}/lists`, { name: "  One  " }).expect(201)).body;
    expect(listResponseSchema.parse(one)).toMatchObject({ name: "One", position: 0 });
    const two = (await a.post(`/boards/${boardId}/lists`, { name: "Two" }).expect(201)).body;
    expect(two.position).toBe(1);

    expect((await a.patch(`/lists/${two.id}`, { name: "Deux" }).expect(200)).body.name).toBe("Deux");
    const moved = await a.post(`/lists/${two.id}/move`, { position: 0 }).expect(200);
    expect(moved.body.map((l: { name: string }) => l.name)).toEqual(["Deux", "One"]);

    await a.delete(`/lists/${one.id}`).expect(204);
    await a.delete(`/lists/${two.id}`).expect(409);
  });

  it("validates input: 400 for bad names, positions; 409 for a taken name", async () => {
    const a = as(cookieA);
    const boardId = await newBoard(cookieA, "Validation");
    await a.post(`/boards/${boardId}/lists`, { name: "   " }).expect(400);
    await a.post(`/boards/${boardId}/lists`, { name: "x".repeat(31) }).expect(400);
    await a.post(`/boards/${boardId}/lists`, { name: "x".repeat(30) }).expect(201);
    await a.post(`/boards/${boardId}/lists`, { name: "X".repeat(30) }).expect(409);
    const list = (await a.post(`/boards/${boardId}/lists`, { name: "Other" }).expect(201)).body;
    await a.post(`/lists/${list.id}/move`, { position: -1 }).expect(400);
    await a.post(`/lists/${list.id}/move`, { position: 1.5 }).expect(400);
  });

  it("gives another user's board and list the same 404 as a missing one", async () => {
    const boardId = await newBoard(cookieA, "Foreign");
    const list = (await as(cookieA).post(`/boards/${boardId}/lists`, { name: "Mine" }).expect(201)).body;
    const b = as(cookieB);
    await b.post(`/boards/${boardId}/lists`, { name: "Stolen" }).expect(404);
    await b.patch(`/lists/${list.id}`, { name: "Stolen" }).expect(404);
    await b.post(`/lists/${list.id}/move`, { position: 0 }).expect(404);
    await b.delete(`/lists/${list.id}`).expect(404);
    await b.patch("/lists/does-not-exist", { name: "x" }).expect(404);
    const after = await as(cookieA).get(`/boards/${boardId}`).expect(200);
    expect(after.body.lists.map((l: { name: string }) => l.name)).toEqual(["Mine"]);
  });
});
