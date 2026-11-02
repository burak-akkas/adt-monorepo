import { Test } from "@nestjs/testing";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { PASSWORD_MIN_LENGTH, VISITOR_IP_HEADER, sessionResponseSchema } from "@adt/contracts";
import request from "supertest";
import { AppModule } from "../app.module.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { mountAuth } from "./auth.module.js";
import { readAuthConfig, readRateLimitConfig } from "./auth.js";

// These tests run against the real local Postgres (docker compose up -d --wait db), like the e2e suite.
process.env.DATABASE_URL ??= "postgresql://kanban:kanban@localhost:5432/kanban";
const ORIGIN = "http://localhost:3000";
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

  describe("account management", () => {
    const signUp = async (name: string) => cookieOf(await post("/auth/sign-up/email", { name, email: email(name), password: PASSWORD }).expect(200));
    const signIn = async (name: string, password = PASSWORD) =>
      post("/auth/sign-in/email", { email: email(name), password });
    const sessionOf = (cookie: string) => request(app.getHttpServer()).get("/auth/get-session").set("Cookie", cookie);

    it("changes the password, revokes other sessions and keeps the current one", async () => {
      const current = await signUp("chg");
      const other = cookieOf(await signIn("chg"));
      expect((await sessionOf(other).expect(200)).body).not.toBeNull();

      const res = await post("/auth/change-password", { currentPassword: PASSWORD, newPassword: "another-good-password-2", revokeOtherSessions: true }, current);
      expect(res.status).toBe(200);

      expect((await sessionOf(other).expect(200)).body).toBeNull();
      const stillIn = await sessionOf(cookieOf(res)).expect(200);
      expect(stillIn.body?.user.email).toBe(email("chg"));

      expect((await signIn("chg")).status).toBe(401);
      expect((await signIn("chg", "another-good-password-2")).status).toBe(200);
    });

    it("rejects a wrong current password and a weak new password without changing anything", async () => {
      const cookie = await signUp("badchg");
      const wrong = await post("/auth/change-password", { currentPassword: "not-the-password-1", newPassword: "another-good-password-2" }, cookie);
      expect(wrong.status).toBe(400);
      expect(wrong.body.code).toBe("INVALID_PASSWORD");

      const weak = await post("/auth/change-password", { currentPassword: PASSWORD, newPassword: "short" }, cookie);
      expect(weak.status).toBe(400);
      expect(weak.body.code).toBe("PASSWORD_TOO_SHORT");

      expect((await signIn("badchg")).status).toBe(200);
    });

    it("rejects an anonymous password change", async () => {
      const res = await post("/auth/change-password", { currentPassword: PASSWORD, newPassword: "another-good-password-2" });
      expect(res.status).toBe(401);
    });

    it("refuses to delete with a wrong password", async () => {
      const cookie = await signUp("keep");
      const res = await post("/auth/delete-user", { password: "not-the-password-1" }, cookie);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("INVALID_PASSWORD");
      expect(await prisma.user.count({ where: { email: email("keep") } })).toBe(1);
      expect((await sessionOf(cookie).expect(200)).body).not.toBeNull();
    });

    it("deletes only the caller's user, sessions and accounts", async () => {
      const victim = await signUp("del");
      await signIn("del");
      const bystander = await signUp("bystander");

      const res = await post("/auth/delete-user", { password: PASSWORD }, victim);
      expect(res.status).toBe(200);

      expect(await prisma.user.count({ where: { email: email("del") } })).toBe(0);
      expect(await prisma.session.count({ where: { user: { email: email("del") } } })).toBe(0);
      expect(await prisma.account.count({ where: { user: { email: email("del") } } })).toBe(0);
      expect((await sessionOf(victim).expect(200)).body).toBeNull();
      expect((await signIn("del")).status).toBe(401);

      expect(await prisma.user.count({ where: { email: email("bystander") } })).toBe(1);
      expect(await prisma.session.count({ where: { user: { email: email("bystander") } } })).toBe(1);
      expect(await prisma.account.count({ where: { user: { email: email("bystander") } } })).toBe(1);
      expect((await sessionOf(bystander).expect(200)).body?.user.email).toBe(email("bystander"));
      expect((await signIn("bystander")).status).toBe(200);
    });

    it("deletes the caller's boards, lists and cards too, and no one else's", async () => {
      const victim = await signUp("owner");
      const bystander = await signUp("owner2");
      const ownerId = (await prisma.user.findFirstOrThrow({ where: { email: email("owner") } })).id;
      const otherId = (await prisma.user.findFirstOrThrow({ where: { email: email("owner2") } })).id;
      const seedBoard = async (userId: string, name: string) => {
        const board = await prisma.board.create({ data: { userId, name } });
        const list = await prisma.boardList.create({ data: { boardId: board.id, name: "To do", position: 0 } });
        await prisma.card.create({ data: { listId: list.id, title: "card", position: 0 } });
        return board.id;
      };
      const ownerBoard = await seedBoard(ownerId, "Owner board");
      const otherBoard = await seedBoard(otherId, "Other board");

      await post("/auth/delete-user", { password: PASSWORD }, victim).expect(200);

      expect(await prisma.board.count({ where: { userId: ownerId } })).toBe(0);
      expect(await prisma.boardList.count({ where: { boardId: ownerBoard } })).toBe(0);
      expect(await prisma.card.count({ where: { list: { boardId: ownerBoard } } })).toBe(0);

      expect(await prisma.board.count({ where: { id: otherBoard } })).toBe(1);
      expect(await prisma.boardList.count({ where: { boardId: otherBoard } })).toBe(1);
      expect(await prisma.card.count({ where: { list: { boardId: otherBoard } } })).toBe(1);
      expect((await sessionOf(bystander).expect(200)).body?.user.email).toBe(email("owner2"));
    });

    it("rejects an anonymous delete", async () => {
      const res = await post("/auth/delete-user", { password: PASSWORD });
      expect(res.status).toBe(401);
    });
  });
});

describe("rate limiting", () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  // Fresh addresses per run: the counters live in the database and outlive the test process.
  const octet = () => Math.floor(Math.random() * 250) + 1;
  const ip = () => `10.${octet()}.${octet()}.${octet()}`;

  const signIn = (visitorIp: string | undefined, extra: Record<string, string> = {}) => {
    const req = request(app.getHttpServer()).post("/auth/sign-in/email").set("Origin", ORIGIN);
    return (visitorIp ? req.set(VISITOR_IP_HEADER, visitorIp) : req)
      .set(extra)
      .send({ email: email("nobody"), password: "wrong-password-123" });
  };

  beforeAll(async () => {
    // vitest.config.ts relaxes the limits for the other specs; this app uses the production defaults.
    const saved = { ...process.env };
    process.env.AUTH_RATE_LIMIT_SIGN_IN_MAX = "5";
    process.env.AUTH_RATE_LIMIT_MAX = "100";
    delete process.env.AUTH_RATE_LIMIT_WINDOW_SECONDS;
    try {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
      mountAuth(app);
      await app.init();
    } finally {
      Object.assign(process.env, saved);
    }
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  it("answers 429 with a retry hint after 5 failed sign-ins from one visitor, and leaves another visitor alone", async () => {
    const visitor = ip();
    const other = ip();
    for (let i = 0; i < 5; i++) expect((await signIn(visitor)).status).toBe(401);

    const blocked = await signIn(visitor);
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers["x-retry-after"])).toBeGreaterThan(0);

    expect((await signIn(other)).status).toBe(401);
  });

  it("keeps the counters in the database under the visitor's address", async () => {
    const visitor = ip();
    await signIn(visitor);
    const row = await prisma.rateLimit.findFirstOrThrow({ where: { key: `${visitor}|/sign-in/email` } });
    expect(row.count).toBe(1);
  });

  it("limits sign-up the same way", async () => {
    const visitor = ip();
    const signUp = () =>
      request(app.getHttpServer())
        .post("/auth/sign-up/email")
        .set("Origin", ORIGIN)
        .set(VISITOR_IP_HEADER, visitor)
        .send({ name: "x", email: "not-an-email", password: PASSWORD });
    for (let i = 0; i < 5; i++) expect((await signUp()).status).toBe(400);
    expect((await signUp()).status).toBe(429);
  });

  it("ignores forwarding headers a client sends, so it cannot pick or change its bucket", async () => {
    const visitor = ip();
    for (let i = 0; i < 5; i++) {
      // A different spoofed address on every request must not give a fresh bucket.
      await signIn(visitor, { "x-forwarded-for": ip(), "x-real-ip": ip(), "x-vercel-forwarded-for": ip() });
    }
    expect((await signIn(visitor, { "x-forwarded-for": ip() })).status).toBe(429);

    const spoofed = ip();
    await signIn(undefined, { "x-forwarded-for": spoofed, "x-real-ip": spoofed });
    expect(await prisma.rateLimit.count({ where: { key: { startsWith: `${spoofed}|` } } })).toBe(0);
  });
});

describe("rate limit configuration", () => {
  it("has strict defaults", () => {
    expect(readRateLimitConfig({})).toEqual({ window: 60, max: 100, signInMax: 5 });
  });

  it("reads the limits from the environment", () => {
    expect(
      readRateLimitConfig({ AUTH_RATE_LIMIT_WINDOW_SECONDS: "30", AUTH_RATE_LIMIT_MAX: "500", AUTH_RATE_LIMIT_SIGN_IN_MAX: "50" }),
    ).toEqual({ window: 30, max: 500, signInMax: 50 });
  });

  it("rejects invalid or non-positive values", () => {
    for (const value of ["0", "-1", "abc", "1.5"]) {
      expect(() => readRateLimitConfig({ AUTH_RATE_LIMIT_SIGN_IN_MAX: value })).toThrow(/AUTH_RATE_LIMIT_SIGN_IN_MAX/);
    }
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
