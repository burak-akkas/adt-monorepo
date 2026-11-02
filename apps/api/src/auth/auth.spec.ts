import { Test } from "@nestjs/testing";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { PASSWORD_MIN_LENGTH, sessionResponseSchema } from "@adt/contracts";
import request from "supertest";
import { AppModule } from "../app.module.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { mountAuth } from "./auth.module.js";
import { readAuthConfig } from "./auth.js";

// These tests run against the real local Postgres (docker compose up -d --wait db), like the e2e suite.
process.env.DATABASE_URL ??= "postgresql://kanban:kanban@localhost:5432/kanban";
const ORIGIN ="http://localhost:3000";
const PASSWORD = "a-good-password-1";
const run = Math.random().toString(36).slice(2, 8);
const email = (name: string) => `${name}-${run}@auth-spec.test`;

describe("Better Auth at /auth", () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  const post = (path: string, body: object, cookie?: string) => {
    const req = request(app.getHttpServer()).post(path).set("Origin", ORIGIN);
    return (cookie ? req.set("Cookie", cookie) : req).send(body);
  };
  const cookieOf = (res: request.Response) => (res.headers["set-cookie"] as unknown as string[]).map((c) => c.split(";")[0]).join("; ");

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
    mountAuth(app);
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { endsWith: `-${run}@auth-spec.test` } } });
    await app.close();
  });

  it("registers a user, normalizes the email and starts an httpOnly session", async () => {
    const res = await post("/auth/sign-up/email", { name: "Ann", email: email("Ann").toUpperCase(), password: PASSWORD }).expect(200);
    expect(res.body.user.email).toBe(email("ann"));
    const cookie = (res.headers["set-cookie"] as unknown as string[]).find((c) => c.includes("session_token"));
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);

    const stored = await prisma.account.findFirstOrThrow({ where: { user: { email: email("ann") } } });
    expect(stored.password).toBeTruthy();
    expect(stored.password).not.toContain(PASSWORD);
    expect(JSON.stringify(res.body)).not.toContain(stored.password!);
  });

  it("rejects a duplicate email in another case, a weak password and a malformed email", async () => {
    const duplicate = await post("/auth/sign-up/email", { name: "Ann", email: email("ANN"), password: PASSWORD });
    expect(duplicate.status).toBe(422);
    expect(duplicate.body.message).toBeTruthy();

    const weak = await post("/auth/sign-up/email", { name: "Bo", email: email("bo"), password: "x".repeat(PASSWORD_MIN_LENGTH - 1) });
    expect(weak.status).toBe(400);
    expect(weak.body.message).toMatch(/short/i);

    const malformed = await post("/auth/sign-up/email", { name: "Cy", email: "not-an-email", password: PASSWORD });
    expect(malformed.status).toBe(400);
    expect(await prisma.user.count({ where: { email: { in: [email("bo"), "not-an-email"] } } })).toBe(0);
  });

  it("answers a wrong password and an unknown email identically", async () => {
    const wrongPassword = await post("/auth/sign-in/email", { email: email("ann"), password: "wrong-password-123" });
    const unknownEmail = await post("/auth/sign-in/email", { email: email("nobody"), password: "wrong-password-123" });
    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(wrongPassword.status);
    expect(unknownEmail.body).toEqual(wrongPassword.body);
  });

  it("signs in, reports the session, and signs out so the old cookie stops working", async () => {
    const login = await post("/auth/sign-in/email", { email: email("ann"), password: PASSWORD }).expect(200);
    expect(JSON.stringify(login.body)).not.toMatch(/"password"|hash/i);
    const cookie = cookieOf(login);

    const session = await request(app.getHttpServer()).get("/auth/get-session").set("Cookie", cookie).expect(200);
    const parsed = sessionResponseSchema.parse({ user: { id: session.body.user.id, email: session.body.user.email } });
    expect(parsed?.user.email).toBe(email("ann"));

    const sessions = () => prisma.session.count({ where: { user: { email: email("ann") } } });
    const before = await sessions();
    await post("/auth/sign-out", {}, cookie).expect(200);
    expect(await sessions()).toBe(before - 1);
    const after = await request(app.getHttpServer()).get("/auth/get-session").set("Cookie", cookie).expect(200);
    expect(after.body).toBeNull();
  });

  it("reports no session without a cookie", async () => {
    const res = await request(app.getHttpServer()).get("/auth/get-session").expect(200);
    expect(res.body).toBeNull();
  });

  it("still parses JSON for the other routes", async () => {
    await request(app.getHttpServer()).get("/health").expect(200);
  });
});

describe("auth configuration", () => {
  it("requires the secret and the URL in production", () => {
    expect(() => readAuthConfig({ NODE_ENV: "production", BETTER_AUTH_URL: "https://x.test" })).toThrow(/BETTER_AUTH_SECRET/);
    expect(() => readAuthConfig({ NODE_ENV: "production", BETTER_AUTH_SECRET: "s".repeat(32) })).toThrow(/BETTER_AUTH_URL/);
  });

  it("accepts production values and falls back to dev defaults elsewhere", () => {
    expect(readAuthConfig({ NODE_ENV: "production", BETTER_AUTH_URL: "https://x.test", BETTER_AUTH_SECRET: "s".repeat(32) }).baseURL).toBe("https://x.test");
    expect(readAuthConfig({}).baseURL).toBe(ORIGIN);
  });
});
