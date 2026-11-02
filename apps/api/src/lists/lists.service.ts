import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { ListResponse } from "@adt/contracts";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";

type ListRow = Prisma.BoardListGetPayload<object>;

function toResponse(list: ListRow): ListResponse {
  return { id: list.id, boardId: list.boardId, name: list.name, position: list.position };
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

const nameTaken = () => new ConflictException("A list with this name already exists on the board");

@Injectable()
export class ListsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Loads a board only together with its owner, so another user's board is simply not found. */
  private async findOwnedBoard(tx: Prisma.TransactionClient, boardId: string, userId: string) {
    const board = await tx.board.findFirst({ where: { id: boardId, userId } });
    if (!board) {
      throw new NotFoundException("Board not found");
    }
    return board;
  }

  /** Loads a list only through its board's owner. */
  private async findOwnedList(tx: Prisma.TransactionClient, id: string, userId: string): Promise<ListRow> {
    const list = await tx.boardList.findFirst({ where: { id, board: { userId } } });
    if (!list) {
      throw new NotFoundException("List not found");
    }
    return list;
  }

  private async assertNameFree(tx: Prisma.TransactionClient, boardId: string, name: string, ignoreId?: string) {
    const lower = name.toLowerCase();
    const lists = await tx.boardList.findMany({ where: { boardId }, select: { id: true, name: true } });
    if (lists.some((l) => l.id !== ignoreId && l.name.toLowerCase() === lower)) {
      throw nameTaken();
    }
  }

  /** Writes positions 0..n-1 for the given ids, touching only rows whose position changed. */
  private async renumber(tx: Prisma.TransactionClient, ordered: { id: string; position: number }[]) {
    for (const [position, list] of ordered.entries()) {
      if (list.position !== position) {
        await tx.boardList.update({ where: { id: list.id }, data: { position } });
      }
    }
  }

  async create(boardId: string, userId: string, name: string): Promise<ListResponse> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.findOwnedBoard(tx, boardId, userId);
        await this.assertNameFree(tx, boardId, name);
        const position = await tx.boardList.count({ where: { boardId } });
        return toResponse(await tx.boardList.create({ data: { boardId, name, position } }));
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw nameTaken();
      throw error;
    }
  }

  async rename(id: string, userId: string, name: string): Promise<ListResponse> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const list = await this.findOwnedList(tx, id, userId);
        await this.assertNameFree(tx, list.boardId, name, id);
        return toResponse(await tx.boardList.update({ where: { id }, data: { name } }));
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw nameTaken();
      throw error;
    }
  }

  /** Moves a list to `position` (clamped to the end) and returns the board's lists in order. */
  async move(id: string, userId: string, position: number): Promise<ListResponse[]> {
    return this.prisma.$transaction(async (tx) => {
      const list = await this.findOwnedList(tx, id, userId);
      const siblings = await tx.boardList.findMany({ where: { boardId: list.boardId }, orderBy: { position: "asc" } });
      const rest = siblings.filter((l) => l.id !== id);
      rest.splice(Math.min(position, rest.length), 0, list);
      await this.renumber(tx, rest);
      const updated = await tx.boardList.findMany({ where: { boardId: list.boardId }, orderBy: { position: "asc" } });
      return updated.map(toResponse);
    });
  }

  async remove(id: string, userId: string, moveTo?: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const list = await this.findOwnedList(tx, id, userId);
      const siblings = await tx.boardList.findMany({ where: { boardId: list.boardId }, orderBy: { position: "asc" } });
      if (siblings.length <= 1) {
        throw new ConflictException("Cannot delete the last list of a board");
      }

      const cards = await tx.card.findMany({ where: { listId: id }, orderBy: { position: "asc" }, select: { id: true } });
      if (cards.length > 0) {
        if (!moveTo) {
          throw new BadRequestException("moveTo is required when the list has cards");
        }
        if (moveTo === id) {
          throw new BadRequestException("moveTo must be a different list");
        }
        const target = siblings.find((l) => l.id === moveTo);
        if (!target) {
          throw new NotFoundException("Target list not found");
        }
        const last = await tx.card.aggregate({ where: { listId: target.id }, _max: { position: true } });
        const start = (last._max.position ?? -1) + 1;
        for (const [offset, card] of cards.entries()) {
          await tx.card.update({ where: { id: card.id }, data: { listId: target.id, position: start + offset } });
        }
      }

      await tx.boardList.delete({ where: { id } });
      await this.renumber(tx, siblings.filter((l) => l.id !== id));
    });
  }
}
