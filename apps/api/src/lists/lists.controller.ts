import { Body, Controller, Delete, HttpCode, Inject, Param, Patch, Post, Put, Query, UseGuards } from "@nestjs/common";
import {
  createListRequestSchema,
  deleteListQuerySchema,
  moveListRequestSchema,
  renameListRequestSchema,
  reorderCardsRequestSchema,
  wipLimitRequestSchema,
  type ArchivedCard,
  type CardResponse,
  type ReorderCardsRequest,
  type CreateListRequest,
  type DeleteListQuery,
  type ListResponse,
  type MoveListRequest,
  type RenameListRequest,
  type WipLimitRequest,
} from "@adt/contracts";
import { SessionGuard, UserEmail, UserId } from "../auth/session.guard.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { ListsService } from "./lists.service.js";

@Controller()
@UseGuards(SessionGuard)
export class ListsController {
  constructor(@Inject(ListsService) private readonly lists: ListsService) {}

  @Post("boards/:boardId/lists")
  create(
    @UserId() userId: string,
    @UserEmail() email: string,
    @Param("boardId") boardId: string,
    @Body(new ZodValidationPipe(createListRequestSchema)) body: CreateListRequest,
  ): Promise<ListResponse> {
    return this.lists.create(boardId, userId, email, body.name);
  }

  @Patch("lists/:id")
  rename(
    @UserId() userId: string,
    @UserEmail() email: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(renameListRequestSchema)) body: RenameListRequest,
  ): Promise<ListResponse> {
    return this.lists.rename(id, userId, email, body.name);
  }

  @Post("lists/:id/move")
  @HttpCode(200)
  move(
    @UserId() userId: string,
    @UserEmail() email: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(moveListRequestSchema)) body: MoveListRequest,
  ): Promise<ListResponse[]> {
    return this.lists.move(id, userId, email, body.position);
  }

  @Put("lists/:id/wip-limit")
  setWipLimit(
    @UserId() userId: string,
    @UserEmail() email: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(wipLimitRequestSchema)) body: WipLimitRequest,
  ): Promise<ListResponse> {
    return this.lists.setWipLimit(id, userId, email, body.limit);
  }

  @Put("lists/:id/cards/order")
  reorderCards(
    @UserId() userId: string,
    @UserEmail() email: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(reorderCardsRequestSchema)) body: ReorderCardsRequest,
  ): Promise<CardResponse[]> {
    return this.lists.reorderCards(id, userId, email, body.cardIds);
  }

  @Post("lists/:id/archive")
  @HttpCode(200)
  archiveCards(@UserId() userId: string, @UserEmail() email: string, @Param("id") id: string): Promise<ArchivedCard[]> {
    return this.lists.archiveCards(id, userId, email);
  }

  @Delete("lists/:id")
  @HttpCode(204)
  async remove(
    @UserId() userId: string,
    @UserEmail() email: string,
    @Param("id") id: string,
    @Query(new ZodValidationPipe(deleteListQuerySchema)) query: DeleteListQuery,
  ): Promise<void> {
    await this.lists.remove(id, userId, email, query.moveTo);
  }
}
