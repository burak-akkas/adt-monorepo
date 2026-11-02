import { Test } from "@nestjs/testing";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { boardDetailSchema, boardSummarySchema } from "@adt/contracts";
import request from "supertest";
import { AppModule } from "../app.module.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { mountAuth } from "../auth/auth.module.js";

// Runs against the real local Postgres, with real sessions.
process.env.DATABASE_URL ??= "postgresql://kanban:kanban@localhost:5432/kanban";
const ORIGIN = "http://localhost:3000";
const PASSWORD = "a-good-password-1";
const run = Math.random().toString(36).slice(2, 8);
const email = (name: string) => `${name}-${run}@boards-http-spec.test`;

describe("/boards over HTTP", () => {
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
    await prisma.user.deleteMany({ where: { email: { endsWith: `-${run}@boards-http-spec.test` } } });
    await app.close();
  });

  it("answers 401 on every route without a session", async () => {
    const server = () => request(app.getHttpServer());
    await server().get("/boards").expect(401);
    await server().post("/boards").send({ name: "x" }).expect(401);
    await server().get("/boards/abc").expect(401);
    await server().patch("/boards/abc").send({ name: "x" }).expect(401);
    await server().post("/boards/abc/duplicate").expect(401);
    await server().delete("/boards/abc").expect(401);
  });

  it("lists the default board, then creates, reads, renames, duplicates and deletes", async () => {
    const a = as(cookieA);
    const listed = await a.get("/boards").expect(200);
    expect(listed.body).toHaveLength(1);
    boardSummarySchema.parse(listed.body[0]);

    const created = await a.post("/boards", { name: "  Trip  " }).expect(201);
    expect(created.body.name).toBe("Trip");

    const read = await a.get(`/boards/${created.body.id}`).expect(200);
    expect(boardDetailSchema.parse(read.body).lists).toEqual([]);

    await a.patch(`/boards/${created.body.id}`, { name: "Trip 2" }).expect(200);
    const copy = await a.post(`/boards/${created.body.id}/duplicate`).expect(201);
    expect(copy.body.name).toBe("Trip 2 (copy)");

    await a.delete(`/boards/${copy.body.id}`).expect(204);
    await a.get(`/boards/${copy.body.id}`).expect(404);
  });

  it("validates input: 400 for an empty or 41-character name, 409 for a taken one", async () => {
    const a = as(cookieA);
    await a.post("/boards", { name: "   " }).expect(400);
    await a.post("/boards", { name: "x".repeat(41) }).expect(400);
    await a.post("/boards", { name: "x".repeat(40) }).expect(201);
    await a.post("/boards", { name: "X".repeat(40) }).expect(409);
    await a.post("/boards", {}).expect(400);
  });

  it("gives another user's board the same 404 as a missing one, and leaves it unchanged", async () => {
    const [mine] = (await as(cookieA).get("/boards")).body;
    const b = as(cookieB);
    const missing = await b.get("/boards/does-not-exist").expect(404);
    const foreign = await b.get(`/boards/${mine.id}`).expect(404);
    expect(foreign.body).toEqual(missing.body);
    await b.patch(`/boards/${mine.id}`, { name: "Stolen" }).expect(404);
    await b.post(`/boards/${mine.id}/duplicate`).expect(404);
    await b.delete(`/boards/${mine.id}`).expect(404);
    expect((await as(cookieB).get("/boards")).body.map((x: { id: string }) => x.id)).not.toContain(mine.id);
    const after = await as(cookieA).get(`/boards/${mine.id}`).expect(200);
    expect(after.body.name).toBe(mine.name);
  });
});
