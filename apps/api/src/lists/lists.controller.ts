import { Body, Controller, Delete, HttpCode, Inject, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import {
  createListRequestSchema,
  deleteListQuerySchema,
  moveListRequestSchema,
  renameListRequestSchema,
  type CreateListRequest,
  type DeleteListQuery,
  type ListResponse,
  type MoveListRequest,
  type RenameListRequest,
} from "@adt/contracts";
import { SessionGuard, UserId } from "../auth/session.guard.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { ListsService } from "./lists.service.js";

@Controller()
@UseGuards(SessionGuard)
export class ListsController {
  constructor(@Inject(ListsService) private readonly lists: ListsService) {}

  @Post("boards/:boardId/lists")
  create(
    @UserId() userId: string,
    @Param("boardId") boardId: string,
    @Body(new ZodValidationPipe(createListRequestSchema)) body: CreateListRequest,
  ): Promise<ListResponse> {
    return this.lists.create(boardId, userId, body.name);
  }

  @Patch("lists/:id")
  rename(
    @UserId() userId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(renameListRequestSchema)) body: RenameListRequest,
  ): Promise<ListResponse> {
    return this.lists.rename(id, userId, body.name);
  }

  @Post("lists/:id/move")
  @HttpCode(200)
  move(
    @UserId() userId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(moveListRequestSchema)) body: MoveListRequest,
  ): Promise<ListResponse[]> {
    return this.lists.move(id, userId, body.position);
  }

  @Delete("lists/:id")
  @HttpCode(204)
  async remove(
    @UserId() userId: string,
    @Param("id") id: string,
    @Query(new ZodValidationPipe(deleteListQuerySchema)) query: DeleteListQuery,
  ): Promise<void> {
    await this.lists.remove(id, userId, query.moveTo);
  }
}
