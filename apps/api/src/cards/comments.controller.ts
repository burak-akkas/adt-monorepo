import { Body, Controller, Delete, Inject, Param, Patch, Post, UseGuards } from "@nestjs/common";
import {
  addCommentRequestSchema,
  editCommentRequestSchema,
  type AddCommentRequest,
  type CardResponse,
  type EditCommentRequest,
} from "@adt/contracts";
import { SessionGuard, UserId } from "../auth/session.guard.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { CommentsService } from "./comments.service.js";

@Controller("cards/:cardId/comments")
@UseGuards(SessionGuard)
export class CommentsController {
  constructor(@Inject(CommentsService) private readonly comments: CommentsService) {}

  @Post()
  add(
    @UserId() userId: string,
    @Param("cardId") cardId: string,
    @Body(new ZodValidationPipe(addCommentRequestSchema)) body: AddCommentRequest,
  ): Promise<CardResponse> {
    return this.comments.add(cardId, userId, body.text);
  }

  @Patch(":commentId")
  edit(
    @UserId() userId: string,
    @Param("cardId") cardId: string,
    @Param("commentId") commentId: string,
    @Body(new ZodValidationPipe(editCommentRequestSchema)) body: EditCommentRequest,
  ): Promise<CardResponse> {
    return this.comments.edit(cardId, commentId, userId, body.text);
  }

  @Delete(":commentId")
  remove(
    @UserId() userId: string,
    @Param("cardId") cardId: string,
    @Param("commentId") commentId: string,
  ): Promise<CardResponse> {
    return this.comments.remove(cardId, commentId, userId);
  }
}
