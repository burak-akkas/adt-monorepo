import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, UseGuards } from "@nestjs/common";
import {
  createBoardRequestSchema,
  renameBoardRequestSchema,
  updateBoardSettingsRequestSchema,
  type BoardDetail,
  type BoardSettings,
  type BoardSummary,
  type CreateBoardRequest,
  type RenameBoardRequest,
  type UpdateBoardSettingsRequest,
} from "@adt/contracts";
import { SessionGuard, UserId } from "../auth/session.guard.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { BoardsService } from "./boards.service.js";

@Controller("boards")
@UseGuards(SessionGuard)
export class BoardsController {
  constructor(@Inject(BoardsService) private readonly boards: BoardsService) {}

  @Get()
  list(@UserId() userId: string): Promise<BoardSummary[]> {
    return this.boards.list(userId);
  }

  @Post()
  create(
    @UserId() userId: string,
    @Body(new ZodValidationPipe(createBoardRequestSchema)) body: CreateBoardRequest,
  ): Promise<BoardSummary> {
    return this.boards.create(userId, body.name);
  }

  @Get(":id")
  get(@UserId() userId: string, @Param("id") id: string): Promise<BoardDetail> {
    return this.boards.get(id, userId);
  }

  @Patch(":id")
  rename(
    @UserId() userId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(renameBoardRequestSchema)) body: RenameBoardRequest,
  ): Promise<BoardSummary> {
    return this.boards.rename(id, userId, body.name);
  }

  @Patch(":id/settings")
  updateSettings(
    @UserId() userId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateBoardSettingsRequestSchema)) body: UpdateBoardSettingsRequest,
  ): Promise<BoardSettings> {
    return this.boards.updateSettings(id, userId, body);
  }

  @Post(":id/duplicate")
  duplicate(@UserId() userId: string, @Param("id") id: string): Promise<BoardSummary> {
    return this.boards.duplicate(id, userId);
  }

  @Delete(":id")
  @HttpCode(204)
  async remove(@UserId() userId: string, @Param("id") id: string): Promise<void> {
    await this.boards.remove(id, userId);
  }
}
