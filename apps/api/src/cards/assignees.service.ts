import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { CardResponse } from "@adt/contracts";
import type { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { boardAccessWhere } from "../boards/board-access.js";
import { recordActivity } from "./activity.js";
import { cardDetails, toCard } from "./card.mapper.js";

/** Who a card is assigned to: only the owner or a member of its board, by lower-cased email. */
@Injectable()
export class AssigneesService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** The board's owner and members, for a card the caller can reach. Anyone else gets a 404. */
  private async participants(tx: Prisma.TransactionClient, id: string, userId: string, email: string): Promise<Set<string>> {
    const card = await tx.card.findFirst({
      where: { id, list: { board: boardAccessWhere(userId, email) } },
      select: { list: { select: { board: { select: { user: { select: { email: true } }, members: { select: { email: true } } } } } } },
    });
    const board = card?.list?.board;
    if (!board) {
      throw new NotFoundException("Card not found");
    }
    return new Set([board.user.email.toLowerCase(), ...board.members.map((m) => m.email.toLowerCase())]);
  }

  private async load(tx: Prisma.TransactionClient, cardId: string): Promise<CardResponse> {
    return toCard(await tx.card.findFirstOrThrow({ where: { id: cardId }, include: cardDetails }));
  }

  /** Assigns the owner or a member. Anyone else is a 400; assigning twice is a no-op without activity. */
  async add(cardId: string, userId: string, email: string, assignee: string): Promise<CardResponse> {
    const target = assignee.trim().toLowerCase();
    return this.prisma.$transaction(async (tx) => {
      const participants = await this.participants(tx, cardId, userId, email);
      if (!participants.has(target)) {
        throw new BadRequestException("Only the board's owner and members can be assigned");
      }
      const { count } = await tx.cardAssignee.createMany({ data: [{ cardId, email: target }], skipDuplicates: true });
      if (count > 0) {
        await recordActivity(tx, cardId, { type: "assigned", to: target });
      }
      return this.load(tx, cardId);
    });
  }

  /** Unassigns an email; someone who isn't assigned is a no-op without activity. */
  async remove(cardId: string, userId: string, email: string, assignee: string): Promise<CardResponse> {
    const target = assignee.trim().toLowerCase();
    return this.prisma.$transaction(async (tx) => {
      await this.participants(tx, cardId, userId, email);
      const { count } = await tx.cardAssignee.deleteMany({ where: { cardId, email: target } });
      if (count > 0) {
        await recordActivity(tx, cardId, { type: "unassigned", to: target });
      }
      return this.load(tx, cardId);
    });
  }
}
