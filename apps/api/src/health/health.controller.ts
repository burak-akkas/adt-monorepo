import { Controller, Get, HttpException, HttpStatus, Inject } from "@nestjs/common";
import type { HealthResponse } from "@adt/contracts";
import { PrismaService } from "../prisma/prisma.service.js";

@Controller("health")
export class HealthController {
  // Explicit @Inject: Vitest's compiler emits no decorator metadata.
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get()
  async check(): Promise<HealthResponse> {
    const commit = process.env.COMMIT_SHA ?? "dev";
    try {
      await this.prisma.appSetting.count();
      return { status: "ok", commit, database: "ok" };
    } catch {
      const body: HealthResponse = { status: "error", commit, database: "error" };
      throw new HttpException(body, HttpStatus.SERVICE_UNAVAILABLE);
    }
  }
}
