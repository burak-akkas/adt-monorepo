import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { CardResponse } from "@adt/contracts";
import type { Prisma } from "../generated/prisma/client.js";
import { boardAccessWhere } from "../boards/board-access.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { cardDetails, toCard } from "./card.mapper.js";

@Injectable()
export class CommentsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Loads a card only through a board the user owns or is a member of, so anyone else's card is simply not found. */
  private async assertOwnedCard(tx: Prisma.TransactionClient, id: string, userId: string, email: string) {
    const card = await tx.card.findFirst({ where: { id, list: { board: boardAccessWhere(userId, email) } }, select: { id: true } });
    if (!card) {
      throw new NotFoundException("Card not found");
    }
  }

  /** Loads a comment only if it belongs to the given card. */
  private async findComment(tx: Prisma.TransactionClient, cardId: string, commentId: string) {
    const comment = await tx.cardComment.findFirst({ where: { id: commentId, cardId } });
    if (!comment) {
      throw new NotFoundException("Comment not found");
    }
    return comment;
  }

  private async load(tx: Prisma.TransactionClient, cardId: string): Promise<CardResponse> {
    return toCard(await tx.card.findFirstOrThrow({ where: { id: cardId }, include: cardDetails }));
  }

  async add(cardId: string, userId: string, email: string, text: string): Promise<CardResponse> {
    return this.prisma.$transaction(async (tx) => {
      await this.assertOwnedCard(tx, cardId, userId, email);
      await tx.cardComment.create({ data: { cardId, text } });
      return this.load(tx, cardId);
    });
  }

  /** Sets `editedAt` only when the (already trimmed) text differs from the stored one. */
  async edit(cardId: string, commentId: string, userId: string, email: string, text: string): Promise<CardResponse> {
    return this.prisma.$transaction(async (tx) => {
      await this.assertOwnedCard(tx, cardId, userId, email);
      const comment = await this.findComment(tx, cardId, commentId);
      if (comment.text !== text) {
        await tx.cardComment.update({ where: { id: commentId }, data: { text, editedAt: new Date() } });
      }
      return this.load(tx, cardId);
    });
  }

  async remove(cardId: string, commentId: string, userId: string, email: string): Promise<CardResponse> {
    return this.prisma.$transaction(async (tx) => {
      await this.assertOwnedCard(tx, cardId, userId, email);
      await this.findComment(tx, cardId, commentId);
      await tx.cardComment.delete({ where: { id: commentId } });
      return this.load(tx, cardId);
    });
  }
}
