import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { CardResponse } from "@adt/contracts";
import type { Prisma } from "../generated/prisma/client.js";
import { boardAccessWhere } from "../boards/board-access.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { recordActivity } from "./activity.js";
import { cardDetails, toCard } from "./card.mapper.js";

@Injectable()
export class ChecklistService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Loads a card only through a board the user owns or is a member of, so anyone else's card is simply not found. */
  private async assertOwnedCard(tx: Prisma.TransactionClient, id: string, userId: string, email: string) {
    const card = await tx.card.findFirst({ where: { id, list: { board: boardAccessWhere(userId, email) } }, select: { id: true } });
    if (!card) {
      throw new NotFoundException("Card not found");
    }
  }

  /** Loads an item only if it belongs to the given card. */
  private async assertItem(tx: Prisma.TransactionClient, cardId: string, itemId: string) {
    const item = await tx.checklistItem.findFirst({ where: { id: itemId, cardId }, select: { id: true, text: true, done: true } });
    if (!item) {
      throw new NotFoundException("Checklist item not found");
    }
    return item;
  }

  /** Rewrites positions to 0..n-1, touching only rows whose position changed. */
  private async renumber(tx: Prisma.TransactionClient, cardId: string) {
    const items = await tx.checklistItem.findMany({
      where: { cardId },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      select: { id: true, position: true },
    });
    for (const [index, item] of items.entries()) {
      if (item.position !== index) {
        await tx.checklistItem.update({ where: { id: item.id }, data: { position: index } });
      }
    }
  }

  private async load(tx: Prisma.TransactionClient, cardId: string): Promise<CardResponse> {
    return toCard(await tx.card.findFirstOrThrow({ where: { id: cardId }, include: cardDetails }));
  }

  async add(cardId: string, userId: string, email: string, text: string): Promise<CardResponse> {
    return this.prisma.$transaction(async (tx) => {
      await this.assertOwnedCard(tx, cardId, userId, email);
      const position = await tx.checklistItem.count({ where: { cardId } });
      await tx.checklistItem.create({ data: { cardId, text, done: false, position } });
      return this.load(tx, cardId);
    });
  }

  async update(
    cardId: string,
    itemId: string,
    userId: string,
    email: string,
    changes: { text?: string; done?: boolean },
  ): Promise<CardResponse> {
    return this.prisma.$transaction(async (tx) => {
      await this.assertOwnedCard(tx, cardId, userId, email);
      const stored = await this.assertItem(tx, cardId, itemId);
      await tx.checklistItem.update({
        where: { id: itemId },
        data: { ...(changes.text !== undefined && { text: changes.text }), ...(changes.done !== undefined && { done: changes.done }) },
      });
      if (changes.done === true && !stored.done) {
        await recordActivity(tx, cardId, { type: "checklistDone", to: changes.text ?? stored.text });
      }
      return this.load(tx, cardId);
    });
  }

  async remove(cardId: string, itemId: string, userId: string, email: string): Promise<CardResponse> {
    return this.prisma.$transaction(async (tx) => {
      await this.assertOwnedCard(tx, cardId, userId, email);
      await this.assertItem(tx, cardId, itemId);
      await tx.checklistItem.delete({ where: { id: itemId } });
      await this.renumber(tx, cardId);
      return this.load(tx, cardId);
    });
  }

  /** `itemIds` must be exactly the card's item ids, each once. */
  async reorder(cardId: string, userId: string, email: string, itemIds: string[]): Promise<CardResponse> {
    return this.prisma.$transaction(async (tx) => {
      await this.assertOwnedCard(tx, cardId, userId, email);
      const items = await tx.checklistItem.findMany({ where: { cardId }, select: { id: true, position: true } });
      const known = new Set(items.map((item) => item.id));
      if (itemIds.length !== items.length || new Set(itemIds).size !== itemIds.length || !itemIds.every((id) => known.has(id))) {
        throw new BadRequestException("itemIds must list every checklist item of the card exactly once");
      }
      const current = new Map(items.map((item) => [item.id, item.position]));
      for (const [index, id] of itemIds.entries()) {
        if (current.get(id) !== index) {
          await tx.checklistItem.update({ where: { id }, data: { position: index } });
        }
      }
      return this.load(tx, cardId);
    });
  }
}
