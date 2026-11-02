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
const email = (name: string) => `${name}-${run}@checklist-http-spec.test`;

describe("checklist over HTTP", () => {
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
    put: (path: string, body: object) => request(app.getHttpServer()).put(path).set("Cookie", cookie).send(body),
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
    await prisma.user.deleteMany({ where: { email: { endsWith: `-${run}@checklist-http-spec.test` } } });
    await app.close();
  });

  it("answers 401 on every route without a session", async () => {
    const server = () => request(app.getHttpServer());
    await server().post("/cards/abc/checklist").send({ text: "x" }).expect(401);
    await server().patch("/cards/abc/checklist/def").send({ done: true }).expect(401);
    await server().delete("/cards/abc/checklist/def").expect(401);
    await server().put("/cards/abc/checklist/order").send({ itemIds: [] }).expect(401);
  });

  it("adds, edits, ticks, reorders and deletes with the right status codes", async () => {
    const a = as(cookieA);
    const cardId = await newCard(cookieA);
    const base = `/cards/${cardId}/checklist`;

    await a.post(base, { text: "  one  " }).expect(201);
    const added = (await a.post(base, { text: "two" }).expect(201)).body;
    expect(cardResponseSchema.parse(added).checklist).toMatchObject([
      { text: "one", done: false },
      { text: "two", done: false },
    ]);
    const [one, two] = added.checklist.map((i: { id: string }) => i.id) as string[];

    const ticked = (await a.patch(`${base}/${one}`, { done: true }).expect(200)).body;
    expect(ticked.checklist[0]).toMatchObject({ text: "one", done: true });
    const edited = (await a.patch(`${base}/${two}`, { text: " 2 " }).expect(200)).body;
    expect(edited.checklist[1]).toMatchObject({ text: "2", done: false });

    const reordered = (await a.put(`${base}/order`, { itemIds: [two, one] }).expect(200)).body;
    expect(reordered.checklist.map((i: { id: string }) => i.id)).toEqual([two, one]);

    const after = (await a.delete(`${base}/${two}`).expect(200)).body;
    expect(after.checklist.map((i: { id: string }) => i.id)).toEqual([one]);
  });

  it("validates input with 400", async () => {
    const a = as(cookieA);
    const cardId = await newCard(cookieA);
    const base = `/cards/${cardId}/checklist`;
    await a.post(base, { text: "   " }).expect(400);
    await a.post(base, {}).expect(400);
    await a.post(base, { text: "x".repeat(201) }).expect(400);
    const added = (await a.post(base, { text: "x".repeat(200) }).expect(201)).body;
    const id = added.checklist[0].id as string;
    await a.patch(`${base}/${id}`, { text: "" }).expect(400);
    await a.patch(`${base}/${id}`, { text: "x".repeat(201) }).expect(400);
    await a.patch(`${base}/${id}`, {}).expect(400);
    await a.patch(`${base}/${id}`, { done: "yes" }).expect(400);
    await a.put(`${base}/order`, {}).expect(400);
    await a.put(`${base}/order`, { itemIds: [] }).expect(400);
    await a.put(`${base}/order`, { itemIds: [id, id] }).expect(400);
    await a.put(`${base}/order`, { itemIds: ["other"] }).expect(400);
  });

  it("gives another user's card or item, and an item id of another card, a 404", async () => {
    const cardId = await newCard(cookieA);
    const otherCardId = await newCard(cookieA);
    const itemId = (await as(cookieA).post(`/cards/${cardId}/checklist`, { text: "mine" }).expect(201)).body.checklist[0].id as string;
    const b = as(cookieB);
    await b.post(`/cards/${cardId}/checklist`, { text: "x" }).expect(404);
    await b.patch(`/cards/${cardId}/checklist/${itemId}`, { done: true }).expect(404);
    await b.delete(`/cards/${cardId}/checklist/${itemId}`).expect(404);
    await b.put(`/cards/${cardId}/checklist/order`, { itemIds: [itemId] }).expect(404);
    await as(cookieA).patch(`/cards/${otherCardId}/checklist/${itemId}`, { done: true }).expect(404);
    await as(cookieA).delete(`/cards/${otherCardId}/checklist/${itemId}`).expect(404);
    expect(await prisma.checklistItem.findUnique({ where: { id: itemId } })).toMatchObject({ text: "mine", done: false, position: 0 });
  });
});
