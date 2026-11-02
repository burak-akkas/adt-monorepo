import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { CardResponse, CreateCardRequest, UpdateCardRequest } from "@adt/contracts";
import type { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { recordActivity, type ActivityEntryInput } from "./activity.js";
import { cardDetails, toCard } from "./card.mapper.js";

/** `YYYY-MM-DD` (already validated by the contract) as UTC midnight, for a `@db.Date` column. */
const toDate = (value: string) => new Date(`${value}T00:00:00.000Z`);

@Injectable()
export class CardsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Loads a card only through its board's owner, so another user's card is simply not found. */
  private async findOwnedCard(tx: Prisma.TransactionClient, id: string, userId: string) {
    const card = await tx.card.findFirst({ where: { id, list: { board: { userId } } }, include: { ...cardDetails, list: true } });
    if (!card) {
      throw new NotFoundException("Card not found");
    }
    return card;
  }

  /** Loads a list only through its board's owner. */
  private async findOwnedList(tx: Prisma.TransactionClient, id: string, userId: string) {
    const list = await tx.boardList.findFirst({ where: { id, board: { userId } } });
    if (!list) {
      throw new NotFoundException("List not found");
    }
    return list;
  }

  /** Writes positions 0..n-1 (and the list) for the given cards, touching only rows that changed. */
  private async renumber(tx: Prisma.TransactionClient, listId: string, ordered: { id: string; listId: string; position: number }[]) {
    for (const [position, card] of ordered.entries()) {
      if (card.position !== position || card.listId !== listId) {
        await tx.card.update({ where: { id: card.id }, data: { listId, position } });
      }
    }
  }

  async create(listId: string, userId: string, body: CreateCardRequest): Promise<CardResponse> {
    return this.prisma.$transaction(async (tx) => {
      await this.findOwnedList(tx, listId, userId);
      const position = await tx.card.count({ where: { listId } });
      const card = await tx.card.create({
        data: {
          listId,
          title: body.title,
          priority: body.priority,
          cover: body.cover ?? null,
          dueDate: body.dueDate ? toDate(body.dueDate) : null,
          notes: body.notes ?? null,
          position,
        },
      });
      await recordActivity(tx, card.id, { type: "created" });
      return toCard(await tx.card.findFirstOrThrow({ where: { id: card.id }, include: cardDetails }));
    });
  }

  async get(id: string, userId: string): Promise<CardResponse> {
    return toCard(await this.findOwnedCard(this.prisma, id, userId));
  }

  async update(id: string, userId: string, body: UpdateCardRequest): Promise<CardResponse> {
    return this.prisma.$transaction(async (tx) => {
      const card = await this.findOwnedCard(tx, id, userId);
      const entries: ActivityEntryInput[] = [];
      if (body.title !== undefined && body.title !== card.title) {
        entries.push({ type: "title", from: card.title, to: body.title });
      }
      if (body.priority !== undefined && body.priority !== card.priority) {
        entries.push({ type: "priority", from: card.priority, to: body.priority });
      }
      if (body.dueDate !== undefined) {
        const oldDue = card.dueDate ? card.dueDate.toISOString().slice(0, 10) : null;
        if (body.dueDate !== oldDue) {
          entries.push({ type: "dueDate", from: oldDue, to: body.dueDate });
        }
      }
      if (body.notes !== undefined && (body.notes ?? "") !== (card.notes ?? "")) {
        entries.push({ type: "description" });
      }

      const data: Prisma.CardUncheckedUpdateInput = {};
      if (body.title !== undefined) data.title = body.title;
      if (body.priority !== undefined) data.priority = body.priority;
      if (body.cover !== undefined) data.cover = body.cover;
      if (body.dueDate !== undefined) data.dueDate = body.dueDate === null ? null : toDate(body.dueDate);
      if (body.notes !== undefined) data.notes = body.notes;
      await tx.card.update({ where: { id }, data });
      // Strictly increasing timestamps keep "newest first" deterministic within one request.
      const base = Date.now();
      for (const [index, entry] of entries.entries()) {
        await recordActivity(tx, id, { ...entry, at: new Date(base + index) });
      }
      return toCard(await tx.card.findFirstOrThrow({ where: { id }, include: cardDetails }));
    });
  }

  async remove(id: string, userId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const card = await this.findOwnedCard(tx, id, userId);
      await tx.card.delete({ where: { id } });
      const rest = await tx.card.findMany({ where: { listId: card.listId }, orderBy: { position: "asc" } });
      await this.renumber(tx, card.listId, rest);
    });
  }

  /** Moves a card to `position` (clamped to the end) of a list on the same board; positions stay dense. */
  async move(id: string, userId: string, listId: string, position: number): Promise<CardResponse> {
    return this.prisma.$transaction(async (tx) => {
      const card = await this.findOwnedCard(tx, id, userId);
      const target = await this.findOwnedList(tx, listId, userId);
      if (target.boardId !== card.list.boardId) {
        throw new NotFoundException("List not found");
      }

      const others = await tx.card.findMany({ where: { listId, id: { not: id } }, orderBy: { position: "asc" } });
      others.splice(Math.min(position, others.length), 0, card);
      await this.renumber(tx, listId, others);

      if (card.listId !== listId) {
        const source = await tx.card.findMany({ where: { listId: card.listId }, orderBy: { position: "asc" } });
        await this.renumber(tx, card.listId, source);
        await recordActivity(tx, id, { type: "moved", from: card.listId, to: listId });
      }
      return toCard(await tx.card.findFirstOrThrow({ where: { id }, include: cardDetails }));
    });
  }
}
