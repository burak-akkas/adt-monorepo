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
import { SessionGuard, UserEmail, UserId } from "../auth/session.guard.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { CardsService } from "./cards.service.js";

@Controller()
@UseGuards(SessionGuard)
export class CardsController {
  constructor(@Inject(CardsService) private readonly cards: CardsService) {}

  @Post("lists/:listId/cards")
  create(
    @UserId() userId: string,
    @UserEmail() email: string,
    @Param("listId") listId: string,
    @Body(new ZodValidationPipe(createCardRequestSchema)) body: CreateCardRequest,
  ): Promise<CardResponse> {
    return this.cards.create(listId, userId, email, body);
  }

  @Get("cards/:id")
  get(@UserId() userId: string, @UserEmail() email: string, @Param("id") id: string): Promise<CardResponse> {
    return this.cards.get(id, userId, email);
  }

  @Patch("cards/:id")
  update(
    @UserId() userId: string,
    @UserEmail() email: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateCardRequestSchema)) body: UpdateCardRequest,
  ): Promise<CardResponse> {
    return this.cards.update(id, userId, email, body);
  }

  @Post("cards/:id/move")
  @HttpCode(200)
  move(
    @UserId() userId: string,
    @UserEmail() email: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(moveCardRequestSchema)) body: MoveCardRequest,
  ): Promise<CardResponse> {
    return this.cards.move(id, userId, email, body.listId, body.position);
  }

  @Post("cards/:id/duplicate")
  duplicate(@UserId() userId: string, @UserEmail() email: string, @Param("id") id: string): Promise<CardResponse> {
    return this.cards.duplicate(id, userId, email);
  }

  @Delete("cards/:id")
  @HttpCode(204)
  async remove(@UserId() userId: string, @UserEmail() email: string, @Param("id") id: string): Promise<void> {
    await this.cards.remove(id, userId, email);
  }
}
