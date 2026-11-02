import { Test } from "@nestjs/testing";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { cardResponseSchema, templateResponseSchema } from "@adt/contracts";
import request from "supertest";
import { AppModule } from "../app.module.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { mountAuth } from "../auth/auth.module.js";

// Runs against the real local Postgres, with real sessions.
process.env.DATABASE_URL ??= "postgresql://kanban:kanban@localhost:5432/kanban";
const ORIGIN = "http://localhost:3000";
const PASSWORD = "a-good-password-1";
const run = Math.random().toString(36).slice(2, 8);
const email = (name: string) => `${name}-${run}@templates-http-spec.test`;

describe("templates over HTTP", () => {
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
    await prisma.user.deleteMany({ where: { email: { endsWith: `-${run}@templates-http-spec.test` } } });
    await app.close();
  });

  it("answers 401 on every route without a session", async () => {
    const server = () => request(app.getHttpServer());
    await server().get("/boards/abc/templates").expect(401);
    await server().post("/boards/abc/templates").send({}).expect(401);
    await server().patch("/templates/abc").send({ name: "x" }).expect(401);
    await server().delete("/templates/abc").expect(401);
    await server().post("/templates/abc/cards").send({}).expect(401);
  });

  it("creates, renames, lists, creates a card from, and deletes a template", async () => {
    const boardId = await newBoard(cookieA, "Flow");
    await prisma.boardList.create({ data: { boardId, name: "L", position: 0 } });
    const created = await as(cookieA)
      .post(`/boards/${boardId}/templates`, { name: "  Bug  ", title: "Fix it", labels: ["bug"], checklist: ["repro"] })
      .expect(201);
    const template = templateResponseSchema.parse(created.body);
    expect(template).toMatchObject({ name: "Bug", priority: "medium", labels: ["bug"], checklist: ["repro"] });

    await as(cookieA).patch(`/templates/${template.id}`, { name: "Bugs" }).expect(200);
    const listed = await as(cookieA).get(`/boards/${boardId}/templates`).expect(200);
    expect(listed.body.map((t: { name: string }) => t.name)).toEqual(["Bugs"]);

    const card = cardResponseSchema.parse((await as(cookieA).post(`/templates/${template.id}/cards`, {}).expect(201)).body);
    expect(card).toMatchObject({ title: "Fix it", labels: ["bug"], dueDate: null, position: 0 });
    expect(card.checklist).toMatchObject([{ text: "repro", done: false }]);

    const board = await as(cookieA).get(`/boards/${boardId}`).expect(200);
    expect(board.body.templates).toHaveLength(1);

    await as(cookieA).delete(`/templates/${template.id}`).expect(204);
    await as(cookieA).delete(`/templates/${template.id}`).expect(404);
  });

  it("answers 400 for a bad name or body and 409 for a taken name or a full board", async () => {
    const boardId = await newBoard(cookieA, "Rules");
    const post = (body: object) => as(cookieA).post(`/boards/${boardId}/templates`, body);
    await post({ name: "   ", title: "t" }).expect(400);
    await post({ name: "x".repeat(41), title: "t" }).expect(400);
    await post({ name: "ok" }).expect(400);
    await post({ name: "ok", title: "t", dueDate: "2026-01-01" }).expect(201);
    await post({ name: "OK", title: "t" }).expect(409);

    await prisma.cardTemplate.createMany({ data: Array.from({ length: 29 }, (_, i) => ({ boardId, name: `T${i}`, title: "t" })) });
    await post({ name: "Over", title: "t" }).expect(409);
  });

  it("answers 404 for another user's board and template", async () => {
    const boardId = await newBoard(cookieA, "Mine");
    await prisma.boardList.create({ data: { boardId, name: "L", position: 0 } });
    const { id } = (await as(cookieA).post(`/boards/${boardId}/templates`, { name: "T", title: "t" }).expect(201)).body;

    await as(cookieB).get(`/boards/${boardId}/templates`).expect(404);
    await as(cookieB).post(`/boards/${boardId}/templates`, { name: "X", title: "t" }).expect(404);
    await as(cookieB).patch(`/templates/${id}`, { name: "X" }).expect(404);
    await as(cookieB).post(`/templates/${id}/cards`, {}).expect(404);
    await as(cookieB).delete(`/templates/${id}`).expect(404);
    expect(await prisma.cardTemplate.findUnique({ where: { id } })).toMatchObject({ name: "T" });
    expect(await prisma.card.count({ where: { list: { boardId } } })).toBe(0);
  });
});
