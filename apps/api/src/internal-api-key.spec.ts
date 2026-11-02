import { INTERNAL_API_KEY_HEADER } from "@adt/contracts";
import { Test } from "@nestjs/testing";
import type { NestExpressApplication } from "@nestjs/platform-express";
import express from "express";
import request from "supertest";
import { AppModule } from "./app.module.js";
import { mountAuth } from "./auth/auth.module.js";
import { internalApiKeyMiddleware, readInternalApiKey } from "./internal-api-key.js";

process.env.DATABASE_URL ??= "postgresql://kanban:kanban@localhost:5432/kanban";
const KEY = "right-key-1234567890";
const DEV_KEY = "dev-only-internal-api-key-not-for-production";

describe("internalApiKeyMiddleware", () => {
  const app = express();
  app.use(internalApiKeyMiddleware(KEY));
  app.get("/ok", (_req, res) => {
    res.json({ ok: true });
  });

  it("rejects a missing header", async () => {
    const res = await request(app).get("/ok");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ statusCode: 401, message: "Unauthorized" });
  });

  it.each([
    ["an empty value", ""],
    ["a wrong key", "wrong-key"],
    ["a wrong key of the same length", "wrong-key-1234567890"],
    ["a prefix of the right key", KEY.slice(0, -1)],
    ["the right key with extra characters", `${KEY}x`],
  ])("rejects %s", async (_name, value) => {
    const res = await request(app).get("/ok").set(INTERNAL_API_KEY_HEADER, value);
    expect(res.status).toBe(401);
    expect(JSON.stringify(res.body)).not.toContain(KEY);
  });

  it("rejects a repeated header (Node joins the values with a comma)", async () => {
    const res = await request(app).get("/ok").set(INTERNAL_API_KEY_HEADER, `${KEY}, ${KEY}`);
    expect(res.status).toBe(401);
  });

  it("passes the right key on to the next handler", async () => {
    const res = await request(app).get("/ok").set(INTERNAL_API_KEY_HEADER, KEY);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});

describe("readInternalApiKey", () => {
  it("throws in production when the key is unset or empty", () => {
    expect(() => readInternalApiKey({ NODE_ENV: "production" })).toThrow("INTERNAL_API_KEY is required in production");
    expect(() => readInternalApiKey({ NODE_ENV: "production", INTERNAL_API_KEY: "" })).toThrow();
  });

  it("returns the set value in production", () => {
    expect(readInternalApiKey({ NODE_ENV: "production", INTERNAL_API_KEY: "real" })).toBe("real");
  });

  it("falls back to the dev default outside production", () => {
    expect(readInternalApiKey({})).toBe(DEV_KEY);
    expect(readInternalApiKey({ NODE_ENV: "development", INTERNAL_API_KEY: "" })).toBe(DEV_KEY);
  });

  it("prefers a set value outside production", () => {
    expect(readInternalApiKey({ NODE_ENV: "development", INTERNAL_API_KEY: "other" })).toBe("other");
  });
});

describe("internalApiKeyMiddleware in front of the real app", () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
    app.use(internalApiKeyMiddleware(KEY));
    mountAuth(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it.each(["/auth/get-session", "/health"])("answers 401 on %s without the key", async (path) => {
    expect((await request(app.getHttpServer()).get(path)).status).toBe(401);
  });

  it.each(["/auth/get-session", "/health"])("answers 200 on %s with the key", async (path) => {
    expect((await request(app.getHttpServer()).get(path).set(INTERNAL_API_KEY_HEADER, KEY)).status).toBe(200);
  });
});
