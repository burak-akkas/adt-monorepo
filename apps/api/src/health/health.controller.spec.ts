import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { healthResponseSchema } from "@adt/contracts";
import request from "supertest";
import { HealthController } from "./health.controller.js";
import { PrismaService } from "../prisma/prisma.service.js";

describe("GET /health", () => {
  let app: INestApplication;
  const count = vi.fn();

  beforeEach(async () => {
    count.mockReset();
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: PrismaService, useValue: { appSetting: { count } } }],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(() => app.close());

  it("answers ok with the deployed commit when the database answers", async () => {
    count.mockResolvedValue(1);
    vi.stubEnv("COMMIT_SHA", "abc123");
    const response = await request(app.getHttpServer()).get("/health").expect(200);
    expect(healthResponseSchema.parse(response.body)).toEqual({ status: "ok", commit: "abc123", database: "ok" });
    vi.unstubAllEnvs();
  });

  it("answers 503 when the database doesn't", async () => {
    count.mockRejectedValue(new Error("down"));
    const response = await request(app.getHttpServer()).get("/health").expect(503);
    expect(healthResponseSchema.parse(response.body).database).toBe("error");
  });
});
