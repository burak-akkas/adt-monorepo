import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, UseGuards } from "@nestjs/common";
import { restoreCardRequestSchema, type ArchivedCard, type CardResponse, type RestoreCardRequest } from "@adt/contracts";
import { SessionGuard, UserId } from "../auth/session.guard.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { ArchiveService } from "./archive.service.js";

@Controller()
@UseGuards(SessionGuard)
export class ArchiveController {
  constructor(@Inject(ArchiveService) private readonly archive: ArchiveService) {}

  @Get("boards/:boardId/archive")
  list(@UserId() userId: string, @Param("boardId") boardId: string): Promise<ArchivedCard[]> {
    return this.archive.list(boardId, userId);
  }

  @Post("cards/:id/archive")
  @HttpCode(200)
  archiveCard(@UserId() userId: string, @Param("id") id: string): Promise<ArchivedCard> {
    return this.archive.archive(id, userId);
  }

  @Post("boards/:boardId/archive/done")
  @HttpCode(200)
  archiveDone(@UserId() userId: string, @Param("boardId") boardId: string): Promise<ArchivedCard[]> {
    return this.archive.archiveDone(boardId, userId);
  }

  @Post("archive/:cardId/restore")
  @HttpCode(200)
  restore(
    @UserId() userId: string,
    @Param("cardId") cardId: string,
    @Body(new ZodValidationPipe(restoreCardRequestSchema)) body: RestoreCardRequest,
  ): Promise<CardResponse> {
    return this.archive.restore(cardId, userId, body.listId);
  }

  @Delete("archive/:cardId")
  @HttpCode(204)
  async remove(@UserId() userId: string, @Param("cardId") cardId: string): Promise<void> {
    await this.archive.remove(cardId, userId);
  }

  @Delete("boards/:boardId/archive")
  @HttpCode(204)
  async empty(@UserId() userId: string, @Param("boardId") boardId: string): Promise<void> {
    await this.archive.empty(boardId, userId);
  }
}
