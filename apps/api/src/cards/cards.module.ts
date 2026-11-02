import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { SessionGuard } from "../auth/session.guard.js";
import { CardsController } from "./cards.controller.js";
import { CardsService } from "./cards.service.js";
import { CommentsController } from "./comments.controller.js";
import { CommentsService } from "./comments.service.js";
import { LabelsController } from "./labels.controller.js";
import { LabelsService } from "./labels.service.js";

@Module({
  imports: [AuthModule],
  controllers: [CardsController, CommentsController, LabelsController],
  providers: [CardsService, CommentsService, LabelsService, SessionGuard],
})
export class CardsModule {}
