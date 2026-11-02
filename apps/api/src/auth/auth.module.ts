import { Module } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { toNodeHandler } from "better-auth/node";
import { PrismaService } from "../prisma/prisma.service.js";
import { createAuth, type Auth } from "./auth.js";

export const AUTH = Symbol("AUTH");

@Module({
  providers: [
    PrismaService,
    { provide: AUTH, useFactory: (prisma: PrismaService) => createAuth(prisma), inject: [PrismaService] },
  ],
  // PrismaService is exported so the whole app shares one instance (one connection pool).
  exports: [AUTH, PrismaService],
})
export class AuthModule {}

/**
 * Create the app with `{ bodyParser: false }`, then call this: Better Auth reads the raw request itself, so its
 * handler must be mounted before any body parser. The JSON parser is added after it for every other route.
 */
export function mountAuth(app: NestExpressApplication): void {
  const auth = app.get<Auth>(AUTH);
  app.use("/auth", toNodeHandler(auth));
  app.useBodyParser("json");
  app.useBodyParser("urlencoded", { extended: true });
}
