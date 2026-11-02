import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  DEFAULT_BOARD_NAME,
  DEFAULT_LIST_NAMES,
  MAX_BOARD_NAME_LENGTH,
  type BoardDetail,
  type BoardSummary,
} from "@adt/contracts";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { toCard } from "../cards/card.mapper.js";

const boardWithContent = {
  lists: { orderBy: { position: "asc" }, include: { cards: { orderBy: { position: "asc" } } } },
} satisfies Prisma.BoardInclude;

type BoardRow = Prisma.BoardGetPayload<object>;
type BoardWithContent = Prisma.BoardGetPayload<{ include: typeof boardWithContent }>;

function toSummary(board: BoardRow): BoardSummary {
  return { id: board.id, name: board.name, createdAt: board.createdAt.toISOString(), updatedAt: board.updatedAt.toISOString() };
}

function toDetail(board: BoardWithContent): BoardDetail {
  return {
    ...toSummary(board),
    lists: board.lists.map((list) => ({
      id: list.id,
      boardId: list.boardId,
      name: list.name,
      position: list.position,
      cards: list.cards.map(toCard),
    })),
  };
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

const nameTaken = () => new ConflictException("A board with this name already exists");

/** "<name> (copy)", then "(copy 2)", ... The base is truncated so the whole name fits and is unique (case-insensitively). */
export function copyBoardName(baseName: string, existingNames: string[]): string {
  const taken = new Set(existingNames.map((name) => name.toLowerCase()));
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? " (copy)" : ` (copy ${n})`;
    const base = baseName.trim().slice(0, Math.max(1, MAX_BOARD_NAME_LENGTH - suffix.length)).trim();
    const name = `${base}${suffix}`;
    if (!taken.has(name.toLowerCase())) {
      return name;
    }
  }
}

@Injectable()
export class BoardsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** The one place that loads a board: always together with its owner, so another user's board is simply not found. */
  private async findOwned(id: string, userId: string): Promise<BoardRow> {
    const board = await this.prisma.board.findFirst({ where: { id, userId } });
    if (!board) {
      throw new NotFoundException("Board not found");
    }
    return board;
  }

  async list(userId: string): Promise<BoardSummary[]> {
    let boards = await this.prisma.board.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
    if (boards.length === 0) {
      try {
        await this.createDefaultBoard(userId);
      } catch (error) {
        // A parallel first request created it already.
        if (!isUniqueViolation(error)) throw error;
      }
      boards = await this.prisma.board.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
    }
    return boards.map(toSummary);
  }

  private createDefaultBoard(userId: string) {
    return this.prisma.$transaction(async (tx) => {
      if ((await tx.board.count({ where: { userId } })) > 0) return;
      await tx.board.create({
        data: {
          userId,
          name: DEFAULT_BOARD_NAME,
          lists: { create: DEFAULT_LIST_NAMES.map((name, position) => ({ name, position })) },
        },
      });
    });
  }

  async create(userId: string, name: string): Promise<BoardSummary> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.assertNameFree(tx, userId, name);
        return toSummary(await tx.board.create({ data: { userId, name } }));
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw nameTaken();
      throw error;
    }
  }

  async get(id: string, userId: string): Promise<BoardDetail> {
    const board = await this.prisma.board.findFirst({ where: { id, userId }, include: boardWithContent });
    if (!board) {
      throw new NotFoundException("Board not found");
    }
    return toDetail(board);
  }

  async rename(id: string, userId: string, name: string): Promise<BoardSummary> {
    await this.findOwned(id, userId);
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.assertNameFree(tx, userId, name, id);
        return toSummary(await tx.board.update({ where: { id }, data: { name } }));
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw nameTaken();
      throw error;
    }
  }

  async duplicate(id: string, userId: string): Promise<BoardSummary> {
    await this.findOwned(id, userId);
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const source = await tx.board.findFirst({ where: { id, userId }, include: boardWithContent });
          if (!source) throw new NotFoundException("Board not found");
          const boards = await tx.board.findMany({ where: { userId }, select: { name: true } });
          const copy = await tx.board.create({
            data: {
              userId,
              name: copyBoardName(source.name, boards.map((b) => b.name)),
              lists: {
                create: source.lists.map((list) => ({
                  name: list.name,
                  position: list.position,
                  cards: {
                    create: list.cards.map((card) => ({
                      title: card.title,
                      priority: card.priority,
                      cover: card.cover,
                      dueDate: card.dueDate,
                      notes: card.notes,
                      position: card.position,
                      createdAt: card.createdAt,
                    })),
                  },
                })),
              },
            },
          });
          return toSummary(copy);
        });
      } catch (error) {
        // Two duplicates raced for the same name: pick the next free one once.
        if (isUniqueViolation(error) && attempt === 0) continue;
        if (isUniqueViolation(error)) throw nameTaken();
        throw error;
      }
    }
  }

  async remove(id: string, userId: string): Promise<void> {
    await this.findOwned(id, userId);
    await this.prisma.$transaction(async (tx) => {
      if ((await tx.board.count({ where: { userId } })) <= 1) {
        throw new ConflictException("Cannot delete the last board");
      }
      await tx.board.deleteMany({ where: { id, userId } });
    });
  }

  private async assertNameFree(tx: Prisma.TransactionClient, userId: string, name: string, ignoreId?: string) {
    const lower = name.toLowerCase();
    const boards = await tx.board.findMany({ where: { userId }, select: { id: true, name: true } });
    if (boards.some((b) => b.id !== ignoreId && b.name.toLowerCase() === lower)) {
      throw nameTaken();
    }
  }
}
