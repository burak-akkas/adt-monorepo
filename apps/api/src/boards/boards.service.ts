import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  DEFAULT_BOARD_NAME,
  DEFAULT_LIST_NAMES,
  MAX_BOARD_NAME_LENGTH,
  type Background,
  type BoardDetail,
  type BoardSettings,
  type BoardSummary,
  type ImportBoardResponse,
  type ParsedImportBoardRequest,
  type UpdateBoardSettingsRequest,
} from "@adt/contracts";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { archiveOrder } from "../archive/archive.service.js";
import { cardDetails, toArchivedCard, toCard, type CardWithDetails } from "../cards/card.mapper.js";
import { boardAccessWhere, boardOwnerWhere } from "./board-access.js";
import { buildBoardImport, importedBoardName } from "./boards.import.js";
import { templateOrder, toTemplate } from "../templates/templates.service.js";

const boardWithContent = {
  lists: { orderBy: { position: "asc" }, include: { cards: { orderBy: { position: "asc" }, include: cardDetails } } },
  formerLists: true,
  templates: { orderBy: templateOrder },
} satisfies Prisma.BoardInclude;

type BoardRow = Prisma.BoardGetPayload<object>;
type BoardWithContent = Prisma.BoardGetPayload<{ include: typeof boardWithContent }>;
type ArchivedCardRow = CardWithDetails;

function toSummary(board: BoardRow, userId: string): BoardSummary {
  return {
    id: board.id,
    name: board.name,
    createdAt: board.createdAt.toISOString(),
    updatedAt: board.updatedAt.toISOString(),
    role: board.userId === userId ? "owner" : "editor",
  };
}

function toBackground(board: BoardRow): Background {
  if (board.backgroundColor) return { type: "color", value: board.backgroundColor };
  if (board.backgroundImageUrl) return { type: "image", url: board.backgroundImageUrl };
  return null;
}

function toSettings(board: BoardRow, lists: { id: string; collapsed: boolean }[]): BoardSettings {
  return {
    background: toBackground(board),
    view: board.view,
    collapsedListIds: lists.filter((list) => list.collapsed).map((list) => list.id),
    doingListId: board.doingListId,
    doneListId: board.doneListId,
  };
}

function toDetail(board: BoardWithContent, archive: ArchivedCardRow[], userId: string): BoardDetail {
  return {
    ...toSummary(board, userId),
    lists: board.lists.map((list) => ({
      id: list.id,
      boardId: list.boardId,
      name: list.name,
      position: list.position,
      wipLimit: list.wipLimit,
      collapsed: list.collapsed,
      cards: list.cards.map(toCard),
    })),
    settings: toSettings(board, board.lists),
    formerLists: Object.fromEntries(board.formerLists.map((former) => [former.listId, former.name])),
    templates: board.templates.map(toTemplate),
    archive: archive.map(toArchivedCard),
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

  /** Loads a board only for its owner (rename, duplicate, delete): editors and strangers get "not found". */
  private async findOwned(id: string, userId: string): Promise<BoardRow> {
    const board = await this.prisma.board.findFirst({ where: { id, ...boardOwnerWhere(userId) } });
    if (!board) {
      throw new NotFoundException("Board not found");
    }
    return board;
  }

  /** Boards the user owns and boards shared with them, oldest first. A user who owns none gets a default board. */
  async list(userId: string, email: string): Promise<BoardSummary[]> {
    const load = () => this.prisma.board.findMany({ where: boardAccessWhere(userId, email), orderBy: { createdAt: "asc" } });
    let boards = await load();
    if (!boards.some((board) => board.userId === userId)) {
      try {
        await this.createDefaultBoard(userId);
      } catch (error) {
        // A parallel first request created it already.
        if (!isUniqueViolation(error)) throw error;
      }
      boards = await load();
    }
    return boards.map((board) => toSummary(board, userId));
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
        return toSummary(await tx.board.create({ data: { userId, name } }), userId);
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw nameTaken();
      throw error;
    }
  }

  async get(id: string, userId: string, email: string): Promise<BoardDetail> {
    const board = await this.prisma.board.findFirst({ where: { id, ...boardAccessWhere(userId, email) }, include: boardWithContent });
    if (!board) {
      throw new NotFoundException("Board not found");
    }
    const archive = await this.prisma.card.findMany({
      where: { boardId: id, archivedAt: { not: null } },
      orderBy: archiveOrder,
      include: cardDetails,
    });
    return toDetail(board, archive, userId);
  }

  async rename(id: string, userId: string, name: string): Promise<BoardSummary> {
    await this.findOwned(id, userId);
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.assertNameFree(tx, userId, name, id);
        return toSummary(await tx.board.update({ where: { id }, data: { name } }), userId);
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw nameTaken();
      throw error;
    }
  }

  /** Changes only the keys present in `update`; `null` clears. List ids must belong to the board. Owners and editors. */
  async updateSettings(id: string, userId: string, email: string, update: UpdateBoardSettingsRequest): Promise<BoardSettings> {
    return this.prisma.$transaction(async (tx) => {
      const board = await tx.board.findFirst({ where: { id, ...boardAccessWhere(userId, email) } });
      if (!board) throw new NotFoundException("Board not found");
      const lists = await tx.boardList.findMany({ where: { boardId: id }, select: { id: true } });
      const own = new Set(lists.map((list) => list.id));
      const collapsedIds = update.collapsedListIds === undefined ? undefined : [...new Set(update.collapsedListIds)];
      for (const listId of [...(collapsedIds ?? []), update.doingListId, update.doneListId]) {
        if (listId && !own.has(listId)) {
          throw new BadRequestException("List does not belong to the board");
        }
      }

      const data: Prisma.BoardUpdateInput = {};
      if (update.background !== undefined) {
        data.backgroundColor = update.background?.type === "color" ? update.background.value : null;
        data.backgroundImageUrl = update.background?.type === "image" ? update.background.url : null;
      }
      if (update.view !== undefined) data.view = update.view;
      if (update.doingListId !== undefined) {
        data.doingList = update.doingListId === null ? { disconnect: true } : { connect: { id: update.doingListId } };
      }
      if (update.doneListId !== undefined) {
        data.doneList = update.doneListId === null ? { disconnect: true } : { connect: { id: update.doneListId } };
      }
      if (collapsedIds !== undefined) {
        await tx.boardList.updateMany({ where: { boardId: id }, data: { collapsed: false } });
        await tx.boardList.updateMany({ where: { boardId: id, id: { in: collapsedIds } }, data: { collapsed: true } });
      }
      const updated = Object.keys(data).length > 0 ? await tx.board.update({ where: { id }, data }) : board;
      const current = await tx.boardList.findMany({ where: { boardId: id }, orderBy: { position: "asc" } });
      return toSettings(updated, current);
    });
  }

  /** Owner-only: the copy would land in the caller's own account. */
  async duplicate(id: string, userId: string): Promise<BoardSummary> {
    await this.findOwned(id, userId);
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const source = await tx.board.findFirst({ where: { id, ...boardOwnerWhere(userId) }, include: boardWithContent });
          if (!source) throw new NotFoundException("Board not found");
          const boards = await tx.board.findMany({ where: { userId }, select: { name: true } });
          const copy = await tx.board.create({
            data: {
              userId,
              name: copyBoardName(source.name, boards.map((b) => b.name)),
              backgroundColor: source.backgroundColor,
              backgroundImageUrl: source.backgroundImageUrl,
              view: source.view,
              templates: {
                create: source.templates.map((template) => ({
                  name: template.name,
                  title: template.title,
                  priority: template.priority,
                  notes: template.notes,
                  labels: template.labels,
                  cover: template.cover,
                  checklist: template.checklist,
                  createdAt: template.createdAt,
                })),
              },
              lists: {
                create: source.lists.map((list) => ({
                  name: list.name,
                  position: list.position,
                  wipLimit: list.wipLimit,
                  collapsed: list.collapsed,
                  cards: {
                    create: list.cards.map((card) => ({
                      title: card.title,
                      priority: card.priority,
                      cover: card.cover,
                      dueDate: card.dueDate,
                      notes: card.notes,
                      position: card.position,
                      createdAt: card.createdAt,
                      checklist: {
                        create: card.checklist.map((item) => ({ text: item.text, done: item.done, position: item.position })),
                      },
                      comments: {
                        create: card.comments.map((comment) => ({
                          text: comment.text,
                          createdAt: comment.createdAt,
                          editedAt: comment.editedAt,
                        })),
                      },
                      labels: { create: card.labels.map((label) => ({ name: label.name, position: label.position })) },
                    })),
                  },
                })),
              },
            },
          });
          // The copied lists have new ids: map the chosen insights lists over by position.
          if (source.doingListId || source.doneListId) {
            const copied = await tx.boardList.findMany({ where: { boardId: copy.id }, orderBy: { position: "asc" } });
            const mapped = (chosen: string | null) => {
              const index = source.lists.findIndex((list) => list.id === chosen);
              return index === -1 ? null : (copied[index]?.id ?? null);
            };
            return toSummary(
              await tx.board.update({
                where: { id: copy.id },
                data: { doingListId: mapped(source.doingListId), doneListId: mapped(source.doneListId) },
              }),
              userId,
            );
          }
          return toSummary(copy, userId);
        });
      } catch (error) {
        // Two duplicates raced for the same name: pick the next free one once.
        if (isUniqueViolation(error) && attempt === 0) continue;
        if (isUniqueViolation(error)) throw nameTaken();
        throw error;
      }
    }
  }

  /**
   * Creates a whole board from a snapshot, once per (user, importKey): a repeated or concurrent import returns
   * the board the first one made. A taken name gets a "(copy)" suffix instead of failing.
   */
  async importBoard(userId: string, email: string, snapshot: ParsedImportBoardRequest): Promise<ImportBoardResponse> {
    const existing = await this.findByImportKey(userId, snapshot.importKey);
    if (existing) return { board: await this.get(existing.id, userId, email), created: false };

    const data = buildBoardImport(snapshot);
    for (let attempt = 0; ; attempt++) {
      try {
        const id = await this.prisma.$transaction(
          async (tx) => {
            const boards = await tx.board.findMany({ where: { userId }, select: { name: true } });
            const names = boards.map((b) => b.name);
            const base = importedBoardName(snapshot.name);
            const name = names.some((n) => n.toLowerCase() === base.toLowerCase()) ? copyBoardName(base, names) : base;
            const board = await tx.board.create({ data: { ...data.create, userId, name, importKey: snapshot.importKey } });
            if (data.doingListId || data.doneListId) {
              await tx.board.update({
                where: { id: board.id },
                data: { doingListId: data.doingListId, doneListId: data.doneListId },
              });
            }
            return board.id;
          },
          { timeout: 60_000, maxWait: 10_000 },
        );
        return { board: await this.get(id, userId, email), created: true };
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        // A parallel request with the same key won the race: return its board.
        const winner = await this.findByImportKey(userId, snapshot.importKey);
        if (winner) return { board: await this.get(winner.id, userId, email), created: false };
        // Otherwise the name was taken in the meantime: pick the next free one once.
        if (attempt > 0) throw nameTaken();
      }
    }
  }

  private findByImportKey(userId: string, importKey: string) {
    return this.prisma.board.findFirst({ where: { userId, importKey }, select: { id: true } });
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
