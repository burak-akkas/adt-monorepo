import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { SessionGuard } from "../auth/session.guard.js";
import { CardsController } from "./cards.controller.js";
import { CardsService } from "./cards.service.js";

@Module({
  imports: [AuthModule],
  controllers: [CardsController],
  providers: [CardsService, SessionGuard],
})
export class CardsModule {}
