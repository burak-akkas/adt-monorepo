import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, UseGuards } from "@nestjs/common";
import {
  createCardFromTemplateRequestSchema,
  createTemplateRequestSchema,
  renameTemplateRequestSchema,
  type CardResponse,
  type CreateCardFromTemplateRequest,
  type CreateTemplateRequest,
  type RenameTemplateRequest,
  type TemplateResponse,
} from "@adt/contracts";
import { SessionGuard, UserId } from "../auth/session.guard.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { TemplatesService } from "./templates.service.js";

@Controller()
@UseGuards(SessionGuard)
export class TemplatesController {
  constructor(@Inject(TemplatesService) private readonly templates: TemplatesService) {}

  @Get("boards/:boardId/templates")
  list(@UserId() userId: string, @Param("boardId") boardId: string): Promise<TemplateResponse[]> {
    return this.templates.list(boardId, userId);
  }

  @Post("boards/:boardId/templates")
  create(
    @UserId() userId: string,
    @Param("boardId") boardId: string,
    @Body(new ZodValidationPipe(createTemplateRequestSchema)) body: CreateTemplateRequest,
  ): Promise<TemplateResponse> {
    return this.templates.create(boardId, userId, body);
  }

  @Patch("templates/:id")
  rename(
    @UserId() userId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(renameTemplateRequestSchema)) body: RenameTemplateRequest,
  ): Promise<TemplateResponse> {
    return this.templates.rename(id, userId, body.name);
  }

  @Delete("templates/:id")
  @HttpCode(204)
  async remove(@UserId() userId: string, @Param("id") id: string): Promise<void> {
    await this.templates.remove(id, userId);
  }

  @Post("templates/:id/cards")
  createCard(
    @UserId() userId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(createCardFromTemplateRequestSchema)) body: CreateCardFromTemplateRequest,
  ): Promise<CardResponse> {
    return this.templates.createCardFromTemplate(id, userId, body.listId);
  }
}
