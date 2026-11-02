import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, UseGuards } from "@nestjs/common";
import {
  createCardRequestSchema,
  moveCardRequestSchema,
  updateCardRequestSchema,
  type CardResponse,
  type CreateCardRequest,
  type MoveCardRequest,
  type UpdateCardRequest,
} from "@adt/contracts";
import { SessionGuard, UserId } from "../auth/session.guard.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { CardsService } from "./cards.service.js";

@Controller()
@UseGuards(SessionGuard)
export class CardsController {
  constructor(@Inject(CardsService) private readonly cards: CardsService) {}

  @Post("lists/:listId/cards")
  create(
    @UserId() userId: string,
    @Param("listId") listId: string,
    @Body(new ZodValidationPipe(createCardRequestSchema)) body: CreateCardRequest,
  ): Promise<CardResponse> {
    return this.cards.create(listId, userId, body);
  }

  @Get("cards/:id")
  get(@UserId() userId: string, @Param("id") id: string): Promise<CardResponse> {
    return this.cards.get(id, userId);
  }

  @Patch("cards/:id")
  update(
    @UserId() userId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateCardRequestSchema)) body: UpdateCardRequest,
  ): Promise<CardResponse> {
    return this.cards.update(id, userId, body);
  }

  @Post("cards/:id/move")
  @HttpCode(200)
  move(
    @UserId() userId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(moveCardRequestSchema)) body: MoveCardRequest,
  ): Promise<CardResponse> {
    return this.cards.move(id, userId, body.listId, body.position);
  }

  @Delete("cards/:id")
  @HttpCode(204)
  async remove(@UserId() userId: string, @Param("id") id: string): Promise<void> {
    await this.cards.remove(id, userId);
  }
}
