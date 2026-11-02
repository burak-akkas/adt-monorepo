import { Body, Controller, Delete, Inject, Param, Patch, Post, Put, UseGuards } from "@nestjs/common";
import {
  addChecklistItemRequestSchema,
  reorderChecklistRequestSchema,
  updateChecklistItemRequestSchema,
  type AddChecklistItemRequest,
  type CardResponse,
  type ReorderChecklistRequest,
  type UpdateChecklistItemRequest,
} from "@adt/contracts";
import { SessionGuard, UserId } from "../auth/session.guard.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { ChecklistService } from "./checklist.service.js";

@Controller("cards/:cardId/checklist")
@UseGuards(SessionGuard)
export class ChecklistController {
  constructor(@Inject(ChecklistService) private readonly checklist: ChecklistService) {}

  @Post()
  add(
    @UserId() userId: string,
    @Param("cardId") cardId: string,
    @Body(new ZodValidationPipe(addChecklistItemRequestSchema)) body: AddChecklistItemRequest,
  ): Promise<CardResponse> {
    return this.checklist.add(cardId, userId, body.text);
  }

  @Put("order")
  reorder(
    @UserId() userId: string,
    @Param("cardId") cardId: string,
    @Body(new ZodValidationPipe(reorderChecklistRequestSchema)) body: ReorderChecklistRequest,
  ): Promise<CardResponse> {
    return this.checklist.reorder(cardId, userId, body.itemIds);
  }

  @Patch(":itemId")
  update(
    @UserId() userId: string,
    @Param("cardId") cardId: string,
    @Param("itemId") itemId: string,
    @Body(new ZodValidationPipe(updateChecklistItemRequestSchema)) body: UpdateChecklistItemRequest,
  ): Promise<CardResponse> {
    return this.checklist.update(cardId, itemId, userId, body);
  }

  @Delete(":itemId")
  remove(
    @UserId() userId: string,
    @Param("cardId") cardId: string,
    @Param("itemId") itemId: string,
  ): Promise<CardResponse> {
    return this.checklist.remove(cardId, itemId, userId);
  }
}
