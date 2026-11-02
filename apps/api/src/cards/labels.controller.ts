import { Body, Controller, Delete, Inject, Param, Post, UseGuards } from "@nestjs/common";
import { addLabelRequestSchema, type AddLabelRequest, type CardResponse } from "@adt/contracts";
import { SessionGuard, UserId } from "../auth/session.guard.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { LabelsService } from "./labels.service.js";

@Controller("cards/:cardId/labels")
@UseGuards(SessionGuard)
export class LabelsController {
  constructor(@Inject(LabelsService) private readonly labels: LabelsService) {}

  @Post()
  add(
    @UserId() userId: string,
    @Param("cardId") cardId: string,
    @Body(new ZodValidationPipe(addLabelRequestSchema)) body: AddLabelRequest,
  ): Promise<CardResponse> {
    return this.labels.add(cardId, userId, body.name);
  }

  @Delete(":name")
  remove(@UserId() userId: string, @Param("cardId") cardId: string, @Param("name") name: string): Promise<CardResponse> {
    return this.labels.remove(cardId, userId, name);
  }
}
