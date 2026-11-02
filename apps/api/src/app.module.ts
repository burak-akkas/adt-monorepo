import { Module } from "@nestjs/common";
import { ArchiveModule } from "./archive/archive.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { BoardsModule } from "./boards/boards.module.js";
import { CardsModule } from "./cards/cards.module.js";
import { HealthController } from "./health/health.controller.js";
import { ListsModule } from "./lists/lists.module.js";
import { TemplatesModule } from "./templates/templates.module.js";

@Module({
  imports: [ArchiveModule, AuthModule, BoardsModule, CardsModule, ListsModule, TemplatesModule],
  controllers: [HealthController],
})
export class AppModule {}
