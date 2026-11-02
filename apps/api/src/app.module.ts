import { Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module.js";
import { BoardsModule } from "./boards/boards.module.js";
import { HealthController } from "./health/health.controller.js";
import { ListsModule } from "./lists/lists.module.js";

@Module({
  imports: [AuthModule, BoardsModule, ListsModule],
  controllers: [HealthController],
})
export class AppModule {}
