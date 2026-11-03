import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { CardResponse } from "@adt/contracts";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { boardAccessWhere } from "../boards/board-access.js";
import { cardDetails, toCard } from "./card.mapper.js";

@Injectable()
export class LabelsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private async assertAccessibleCard(tx: Prisma.TransactionClient, id: string, userId: string, email: string) {
    const card = await tx.card.findFirst({ where: { id, list: { board: boardAccessWhere(userId, email) } }, select: { id: true } });
    if (!card) {
      throw new NotFoundException("Card not found");
    }
  }

  private async load(tx: Prisma.TransactionClient, cardId: string): Promise<CardResponse> {
    return toCard(await tx.card.findFirstOrThrow({ where: { id: cardId }, include: cardDetails }));
  }

  /** Adds a label at the end; a case-insensitive duplicate on the same card is a 409. */
  async add(cardId: string, userId: string, email: string, name: string): Promise<CardResponse> {
    try {
      // The insert is the last write: a unique violation aborts the Postgres transaction.
      return await this.prisma.$transaction(async (tx) => {
        await this.assertAccessibleCard(tx, cardId, userId, email);
        const position = await tx.cardLabel.count({ where: { cardId } });
        await tx.cardLabel.create({ data: { cardId, name, position } });
        return this.load(tx, cardId);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("Card already has this label");
      }
      throw error;
    }
  }

  /** Removes the label matching `name` ignoring case; no match is a no-op. Positions stay dense. */
  async remove(cardId: string, userId: string, email: string, name: string): Promise<CardResponse> {
    return this.prisma.$transaction(async (tx) => {
      await this.assertAccessibleCard(tx, cardId, userId, email);
      await tx.cardLabel.deleteMany({ where: { cardId, name: { equals: name.trim(), mode: "insensitive" } } });
      const rest = await tx.cardLabel.findMany({ where: { cardId }, orderBy: { position: "asc" } });
      for (const [position, label] of rest.entries()) {
        if (label.position !== position) {
          await tx.cardLabel.update({ where: { id: label.id }, data: { position } });
        }
      }
      return this.load(tx, cardId);
    });
  }
}
