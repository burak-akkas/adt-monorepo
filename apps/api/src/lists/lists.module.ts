import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { SessionGuard } from "../auth/session.guard.js";
import { ListsController } from "./lists.controller.js";
import { ListsService } from "./lists.service.js";

@Module({
  imports: [AuthModule],
  controllers: [ListsController],
  providers: [ListsService, SessionGuard],
})
export class ListsModule {}
