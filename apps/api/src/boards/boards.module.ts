import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { SessionGuard } from "../auth/session.guard.js";
import { BoardsController } from "./boards.controller.js";
import { BoardsService } from "./boards.service.js";

@Module({
  imports: [AuthModule],
  controllers: [BoardsController],
  providers: [BoardsService, SessionGuard],
})
export class BoardsModule {}
