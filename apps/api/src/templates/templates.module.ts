import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { SessionGuard } from "../auth/session.guard.js";
import { TemplatesController } from "./templates.controller.js";
import { TemplatesService } from "./templates.service.js";

@Module({
  imports: [AuthModule],
  controllers: [TemplatesController],
  providers: [TemplatesService, SessionGuard],
})
export class TemplatesModule {}
