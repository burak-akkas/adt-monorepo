import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { SessionGuard } from "../auth/session.guard.js";
import { ArchiveController } from "./archive.controller.js";
import { ArchiveService } from "./archive.service.js";

@Module({
  imports: [AuthModule],
  controllers: [ArchiveController],
  providers: [ArchiveService, SessionGuard],
})
export class ArchiveModule {}
