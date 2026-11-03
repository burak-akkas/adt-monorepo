import { Test } from "@nestjs/testing";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { boardMembersResponseSchema, memberSchema } from "@adt/contracts";
import request from "supertest";
import { AppModule } from "../app.module.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { mountAuth } from "../auth/auth.module.js";

// Runs against the real local Postgres, with real sessions.
process.env.DATABASE_URL ??= "postgresql://kanban:kanban@localhost:5432/kanban";
const ORIGIN = "http://localhost:3000";
const PASSWORD = "a-good-password-1";
const run = Math.random().toString(36).slice(2, 8);
const email = (name: string) => `${name}-${run}@members-http-spec.test`;

describe("board members over HTTP", () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let cookies: Record<"a" | "b" | "c", string>;
  let boardId: string;

  const signUp = async (name: string) => {
    const res = await request(app.getHttpServer())
      .post("/auth/sign-up/email")
      .set("Origin", ORIGIN)
      .send({ name, email: email(name), password: PASSWORD })
      .expect(200);
    return (res.headers["set-cookie"] as unknown as string[]).map((c) => c.split(";")[0]).join("; ");
  };
  const as = (who: keyof typeof cookies) => ({
    get: (path: string) => request(app.getHttpServer()).get(path).set("Cookie", cookies[who]),
    post: (path: string, body: object = {}) =>
      request(app.getHttpServer()).post(path).set("Cookie", cookies[who]).send(body),
    delete: (path: string) => request(app.getHttpServer()).delete(path).set("Cookie", cookies[who]),
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
    mountAuth(app);
    await app.init();
    prisma = app.get(PrismaService);
    cookies = { a: await signUp("a"), b: await signUp("b"), c: await signUp("c") };
  });

  beforeEach(async () => {
    boardId = (await as("a").post("/boards", { name: `Shared ${Math.random()}` }).expect(201)).body.id as string;
    await as("a").post(`/boards/${boardId}/members`, { email: email("b") }).expect(201);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { endsWith: `-${run}@members-http-spec.test` } } });
    await app.close();
  });

  it("needs a session", async () => {
    await request(app.getHttpServer()).get(`/boards/${boardId}/members`).expect(401);
  });

  it("lets the owner and a member list the members, and hides them from a non-member", async () => {
    for (const who of ["a", "b"] as const) {
      const body = boardMembersResponseSchema.parse((await as(who).get(`/boards/${boardId}/members`).expect(200)).body);
      expect(body.owner.email).toBe(email("a"));
      expect(body.members.map((m) => m.email)).toEqual([email("b")]);
    }
    await as("c").get(`/boards/${boardId}/members`).expect(404);
  });

  it("validates the invitation and stores the email lower-cased", async () => {
    await as("a").post(`/boards/${boardId}/members`, { email: "not-an-email" }).expect(400);
    await as("a").post(`/boards/${boardId}/members`, {}).expect(400);
    const added = memberSchema.parse(
      (await as("a").post(`/boards/${boardId}/members`, { email: ` ${email("c").toUpperCase()} ` }).expect(201)).body,
    );
    expect(added.email).toBe(email("c"));
  });

  it("rejects the owner's own email and a duplicate in another case", async () => {
    const own = await as("a").post(`/boards/${boardId}/members`, { email: email("a").toUpperCase() }).expect(400);
    expect(own.body.message).toBe("You already own this board");
    await as("a").post(`/boards/${boardId}/members`, { email: email("b").toUpperCase() }).expect(409);
  });

  it("lets only the owner invite or remove", async () => {
    await as("b").post(`/boards/${boardId}/members`, { email: "x@example.test" }).expect(403);
    await as("c").post(`/boards/${boardId}/members`, { email: "x@example.test" }).expect(404);
    const memberId = (await as("a").get(`/boards/${boardId}/members`)).body.members[0].id as string;
    await as("b").delete(`/boards/${boardId}/members/${memberId}`).expect(403);
    await as("c").delete(`/boards/${boardId}/members/${memberId}`).expect(404);
    await as("a").delete(`/boards/${boardId}/members/${memberId}`).expect(204);
    expect(await prisma.boardMember.count({ where: { boardId } })).toBe(0);
  });

  it("answers 404 for a member id from another board", async () => {
    const otherBoard = (await as("c").post("/boards", { name: `Other ${Math.random()}` }).expect(201)).body.id as string;
    const foreign = (await as("c").post(`/boards/${otherBoard}/members`, { email: "z@example.test" }).expect(201)).body;
    await as("a").delete(`/boards/${boardId}/members/${foreign.id}`).expect(404);
    expect(await prisma.boardMember.count({ where: { boardId: otherBoard } })).toBe(1);
  });

  it("routes DELETE .../members/me to leave, not to remove", async () => {
    await as("a").delete(`/boards/${boardId}/members/me`).expect(400);
    await as("c").delete(`/boards/${boardId}/members/me`).expect(404);
    await as("b").delete(`/boards/${boardId}/members/me`).expect(204);
    expect(await prisma.boardMember.count({ where: { boardId } })).toBe(0);
  });

  it("lets a member read the board, but not a non-member (see board-sharing.security.spec.ts for the rest)", async () => {
    await as("b").get(`/boards/${boardId}`).expect(200);
    await as("c").get(`/boards/${boardId}`).expect(404);
  });
});
