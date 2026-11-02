import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { ArchivedCard, CardResponse } from "@adt/contracts";
import type { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { insightsListIds } from "../boards/insights-lists.js";
import { recordActivity } from "../cards/activity.js";
import { cardDetails, toArchivedCard, toCard } from "../cards/card.mapper.js";

/** Oldest first; the id breaks ties so the order is deterministic. */
export const archiveOrder = [{ archivedAt: "asc" }, { id: "asc" }] satisfies Prisma.CardOrderByWithRelationInput[];

@Injectable()
export class ArchiveService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Loads a board only through its owner, so another user's board is simply not found. */
  private async findOwnedBoard(tx: Prisma.TransactionClient, id: string, userId: string) {
    const board = await tx.board.findFirst({ where: { id, userId } });
    if (!board) {
      throw new NotFoundException("Board not found");
    }
    return board;
  }

  /** Writes positions 0..n-1 for the cards of a list, touching only rows that changed. */
  private async renumber(tx: Prisma.TransactionClient, listId: string) {
    const cards = await tx.card.findMany({ where: { listId }, orderBy: { position: "asc" } });
    for (const [position, card] of cards.entries()) {
      if (card.position !== position) {
        await tx.card.update({ where: { id: card.id }, data: { position } });
      }
    }
  }

  async list(boardId: string, userId: string): Promise<ArchivedCard[]> {
    await this.findOwnedBoard(this.prisma, boardId, userId);
    const cards = await this.prisma.card.findMany({
      where: { boardId, archivedAt: { not: null } },
      orderBy: archiveOrder,
      include: cardDetails,
    });
    return cards.map(toArchivedCard);
  }

  async archive(id: string, userId: string): Promise<ArchivedCard> {
    return this.prisma.$transaction(async (tx) => {
      const card = await tx.card.findFirst({ where: { id, list: { board: { userId } } }, include: { list: true } });
      if (!card || !card.list || card.listId === null) {
        throw new NotFoundException("Card not found");
      }
      const archivedAt = new Date();
      await tx.card.update({
        where: { id },
        data: { listId: null, boardId: card.list.boardId, archivedAt, position: 0 },
      });
      await recordActivity(tx, id, { type: "archived", at: archivedAt });
      await this.renumber(tx, card.listId);
      return toArchivedCard(await tx.card.findFirstOrThrow({ where: { id }, include: cardDetails }));
    });
  }

  /** Archives every card of the board's done list (the chosen one, else the list named Done). */
  async archiveDone(boardId: string, userId: string): Promise<ArchivedCard[]> {
    return this.prisma.$transaction(async (tx) => {
      const board = await this.findOwnedBoard(tx, boardId, userId);
      const lists = await tx.boardList.findMany({ where: { boardId }, orderBy: { position: "asc" } });
      const doneId = insightsListIds(board, lists).done;
      if (!doneId) return [];
      const cards = await tx.card.findMany({ where: { listId: doneId }, orderBy: { position: "asc" }, select: { id: true } });
      // Strictly increasing timestamps keep "oldest first" in list order.
      const base = Date.now();
      for (const [index, card] of cards.entries()) {
        const archivedAt = new Date(base + index);
        await tx.card.update({
          where: { id: card.id },
          data: { listId: null, boardId, archivedAt, position: 0 },
        });
        await recordActivity(tx, card.id, { type: "archived", at: archivedAt });
      }
      if (cards.length === 0) return [];
      const archived = await tx.card.findMany({ where: { id: { in: cards.map((card) => card.id) } }, include: cardDetails });
      const order = new Map(cards.map((card, index) => [card.id, index]));
      return archived.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)).map(toArchivedCard);
    });
  }

  /** Puts an archived card at the end of a list of its board: the given one, else done, else the last list. */
  async restore(id: string, userId: string, listId?: string): Promise<CardResponse> {
    return this.prisma.$transaction(async (tx) => {
      const card = await tx.card.findFirst({
        where: { id, archivedAt: { not: null }, board: { userId } },
      });
      if (!card || card.boardId === null) {
        throw new NotFoundException("Archived card not found");
      }
      const board = await this.findOwnedBoard(tx, card.boardId, userId);
      const lists = await tx.boardList.findMany({ where: { boardId: board.id }, orderBy: { position: "asc" } });

      let targetId: string | undefined;
      if (listId !== undefined) {
        targetId = lists.find((list) => list.id === listId)?.id;
        if (!targetId) throw new NotFoundException("List not found");
      } else {
        targetId = insightsListIds(board, lists).done ?? lists.at(-1)?.id;
        // A board without lists has nowhere to restore to.
        if (!targetId) throw new NotFoundException("List not found");
      }

      const last = await tx.card.aggregate({ where: { listId: targetId }, _max: { position: true } });
      await tx.card.update({
        where: { id },
        data: { listId: targetId, boardId: null, archivedAt: null, position: (last._max.position ?? -1) + 1 },
      });
      await recordActivity(tx, id, { type: "restored" });
      return toCard(await tx.card.findFirstOrThrow({ where: { id }, include: cardDetails }));
    });
  }

  async remove(id: string, userId: string): Promise<void> {
    const { count } = await this.prisma.card.deleteMany({ where: { id, archivedAt: { not: null }, board: { userId } } });
    if (count === 0) {
      throw new NotFoundException("Archived card not found");
    }
  }

  async empty(boardId: string, userId: string): Promise<void> {
    await this.findOwnedBoard(this.prisma, boardId, userId);
    await this.prisma.card.deleteMany({ where: { boardId, archivedAt: { not: null } } });
  }
}
