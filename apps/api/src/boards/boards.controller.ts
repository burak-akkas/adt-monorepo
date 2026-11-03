import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import {
  createBoardRequestSchema,
  importBoardRequestSchema,
  type ImportBoardResponse,
  type ParsedImportBoardRequest,
  renameBoardRequestSchema,
  updateBoardSettingsRequestSchema,
  type BoardDetail,
  type BoardSettings,
  type BoardSummary,
  type CreateBoardRequest,
  type RenameBoardRequest,
  type UpdateBoardSettingsRequest,
} from "@adt/contracts";
import { SessionGuard, UserEmail, UserId } from "../auth/session.guard.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { BoardsService } from "./boards.service.js";

@Controller("boards")
@UseGuards(SessionGuard)
export class BoardsController {
  constructor(@Inject(BoardsService) private readonly boards: BoardsService) {}

  @Get()
  list(@UserId() userId: string, @UserEmail() email: string): Promise<BoardSummary[]> {
    return this.boards.list(userId, email);
  }

  @Post()
  create(
    @UserId() userId: string,
    @Body(new ZodValidationPipe(createBoardRequestSchema)) body: CreateBoardRequest,
  ): Promise<BoardSummary> {
    return this.boards.create(userId, body.name);
  }

  /** 201 when the board was created, 200 when the importKey had been used already (the existing board is returned). */
  @Post("import")
  async importBoard(
    @UserId() userId: string,
    @UserEmail() email: string,
    @Body(new ZodValidationPipe(importBoardRequestSchema)) body: ParsedImportBoardRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ImportBoardResponse> {
    const result = await this.boards.importBoard(userId, email, body);
    res.status(result.created ? 201 : 200);
    return result;
  }

  @Get(":id")
  get(@UserId() userId: string, @UserEmail() email: string, @Param("id") id: string): Promise<BoardDetail> {
    return this.boards.get(id, userId, email);
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
    @UserEmail() email: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateBoardSettingsRequestSchema)) body: UpdateBoardSettingsRequest,
  ): Promise<BoardSettings> {
    return this.boards.updateSettings(id, userId, email, body);
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
