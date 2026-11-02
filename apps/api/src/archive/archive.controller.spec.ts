import { Test } from "@nestjs/testing";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { archivedCardSchema, cardResponseSchema } from "@adt/contracts";
import request from "supertest";
import { AppModule } from "../app.module.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { mountAuth } from "../auth/auth.module.js";

// Runs against the real local Postgres, with real sessions.
process.env.DATABASE_URL ??= "postgresql://kanban:kanban@localhost:5432/kanban";
const ORIGIN = "http://localhost:3000";
const PASSWORD = "a-good-password-1";
const run = Math.random().toString(36).slice(2, 8);
const email = (name: string) => `${name}-${run}@archive-http-spec.test`;

describe("archive over HTTP", () => {
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
    await prisma.user.deleteMany({ where: { email: { endsWith: `-${run}@archive-http-spec.test` } } });
    await app.close();
  });

  it("answers 401 on every route without a session", async () => {
    const server = () => request(app.getHttpServer());
    await server().get("/boards/abc/archive").expect(401);
    await server().post("/cards/abc/archive").send({}).expect(401);
    await server().post("/boards/abc/archive/done").send({}).expect(401);
    await server().post("/archive/abc/restore").send({}).expect(401);
    await server().delete("/archive/abc").expect(401);
    await server().delete("/boards/abc/archive").expect(401);
  });

  it("archives, lists, restores and deletes through the API", async () => {
    const board = (await as(cookieA).get("/boards").expect(200)).body[0].id as string;
    const detail = (await as(cookieA).get(`/boards/${board}`).expect(200)).body;
    const [todo, , done] = detail.lists as { id: string }[];
    const make = async (listId: string, title: string) =>
      cardResponseSchema.parse((await as(cookieA).post(`/lists/${listId}/cards`, { title }).expect(201)).body);
    const a = await make(todo.id, "a");
    const b = await make(todo.id, "b");
    await make(done.id, "d");

    const archived = archivedCardSchema.parse((await as(cookieA).post(`/cards/${a.id}/archive`).expect(200)).body);
    expect(archived).toMatchObject({ id: a.id, boardId: board });
    await as(cookieA).get(`/cards/${a.id}`).expect(404);

    const doneArchived = (await as(cookieA).post(`/boards/${board}/archive/done`).expect(200)).body;
    expect(doneArchived.map((card: { title: string }) => card.title)).toEqual(["d"]);

    const listed = (await as(cookieA).get(`/boards/${board}/archive`).expect(200)).body;
    expect(listed.map((card: { title: string }) => card.title)).toEqual(["a", "d"]);
    expect((await as(cookieA).get(`/boards/${board}`).expect(200)).body.archive).toHaveLength(2);

    const restored = cardResponseSchema.parse((await as(cookieA).post(`/archive/${a.id}/restore`, { listId: todo.id }).expect(200)).body);
    expect(restored).toMatchObject({ id: a.id, listId: todo.id, position: 1 });
    await as(cookieA).post(`/archive/${doneArchived[0].id}/restore`, { listId: 5 }).expect(400);
    await as(cookieA).delete(`/archive/${doneArchived[0].id}`).expect(204)
    await as(cookieA).delete(`/archive/${doneArchived[0].id}`).expect(404);

    await as(cookieA).post(`/cards/${b.id}/archive`).expect(200);
    await as(cookieA).delete(`/boards/${board}/archive`).expect(204);
    expect((await as(cookieA).get(`/boards/${board}/archive`).expect(200)).body).toEqual([]);
  });

  it("answers 404 for another user's board and card", async () => {
    const board = (await as(cookieA).get("/boards").expect(200)).body[0].id as string;
    const listId = (await as(cookieA).get(`/boards/${board}`).expect(200)).body.lists[0].id as string;
    const card = cardResponseSchema.parse((await as(cookieA).post(`/lists/${listId}/cards`, { title: "mine" }).expect(201)).body);

    await as(cookieB).get(`/boards/${board}/archive`).expect(404);
    await as(cookieB).post(`/cards/${card.id}/archive`).expect(404);
    await as(cookieB).post(`/boards/${board}/archive/done`).expect(404);
    await as(cookieB).delete(`/boards/${board}/archive`).expect(404);

    await as(cookieA).post(`/cards/${card.id}/archive`).expect(200);
    await as(cookieB).post(`/archive/${card.id}/restore`).expect(404);
    await as(cookieB).delete(`/archive/${card.id}`).expect(404);
    expect(await prisma.card.findUniqueOrThrow({ where: { id: card.id } })).toMatchObject({ listId: null, boardId: board });
  });
});
