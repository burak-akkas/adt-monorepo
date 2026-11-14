import { Body, Controller, Delete, Inject, Param, Post, UseGuards } from "@nestjs/common";
import { addAssigneeRequestSchema, type AddAssigneeRequest, type CardResponse } from "@adt/contracts";
import { SessionGuard, UserEmail, UserId } from "../auth/session.guard.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { AssigneesService } from "./assignees.service.js";

@Controller("cards/:cardId/assignees")
@UseGuards(SessionGuard)
export class AssigneesController {
  constructor(@Inject(AssigneesService) private readonly assignees: AssigneesService) {}

  @Post()
  add(
    @UserId() userId: string,
    @UserEmail() email: string,
    @Param("cardId") cardId: string,
    @Body(new ZodValidationPipe(addAssigneeRequestSchema)) body: AddAssigneeRequest,
  ): Promise<CardResponse> {
    return this.assignees.add(cardId, userId, email, body.email);
  }

  @Delete(":email")
  remove(
    @UserId() userId: string,
    @UserEmail() email: string,
    @Param("cardId") cardId: string,
    @Param("email") assignee: string,
  ): Promise<CardResponse> {
    return this.assignees.remove(cardId, userId, email, assignee);
  }
}
