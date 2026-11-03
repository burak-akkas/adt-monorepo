import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { MAX_TEMPLATES, type CardResponse, type CreateTemplateRequest, type TemplateResponse } from "@adt/contracts";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { cardDetails, toCard } from "../cards/card.mapper.js";
import { boardAccessWhere } from "../boards/board-access.js";

type TemplateRow = Prisma.CardTemplateGetPayload<object>;

export function toTemplate(template: TemplateRow): TemplateResponse {
  return {
    id: template.id,
    boardId: template.boardId,
    name: template.name,
    title: template.title,
    priority: template.priority,
    notes: template.notes,
    labels: template.labels,
    cover: template.cover,
    checklist: template.checklist,
    createdAt: template.createdAt.toISOString(),
  };
}

/** The stable order templates are read in. */
export const templateOrder = [{ createdAt: "asc" }, { id: "asc" }] satisfies Prisma.CardTemplateOrderByWithRelationInput[];

const nameTaken = () => new ConflictException("A template with this name already exists");

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/** Drops repeats ignoring case (a card can't hold the same label twice), keeping the first spelling. */
function uniqueLabels(labels: string[]): string[] {
  const seen = new Set<string>();
  return labels.filter((label) => {
    const key = label.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

@Injectable()
export class TemplatesService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Loads a board only if the user owns it or is a member, so any other board is simply not found. */
  private async findOwnedBoard(tx: Prisma.TransactionClient, id: string, userId: string, email: string) {
    const board = await tx.board.findFirst({ where: { id, ...boardAccessWhere(userId, email) } });
    if (!board) {
      throw new NotFoundException("Board not found");
    }
    return board;
  }

  /** Loads a template only through a board the user owns or is a member of. */
  private async findOwnedTemplate(tx: Prisma.TransactionClient, id: string, userId: string, email: string) {
    const template = await tx.cardTemplate.findFirst({ where: { id, board: boardAccessWhere(userId, email) } });
    if (!template) {
      throw new NotFoundException("Template not found");
    }
    return template;
  }

  private async assertNameFree(tx: Prisma.TransactionClient, boardId: string, name: string, ignoreId?: string) {
    const lower = name.toLowerCase();
    const templates = await tx.cardTemplate.findMany({ where: { boardId }, select: { id: true, name: true } });
    if (templates.some((t) => t.id !== ignoreId && t.name.toLowerCase() === lower)) {
      throw nameTaken();
    }
  }

  async list(boardId: string, userId: string, email: string): Promise<TemplateResponse[]> {
    await this.findOwnedBoard(this.prisma, boardId, userId, email);
    const templates = await this.prisma.cardTemplate.findMany({ where: { boardId }, orderBy: templateOrder });
    return templates.map(toTemplate);
  }

  async create(boardId: string, userId: string, email: string, body: CreateTemplateRequest): Promise<TemplateResponse> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.findOwnedBoard(tx, boardId, userId, email);
        if ((await tx.cardTemplate.count({ where: { boardId } })) >= MAX_TEMPLATES) {
          throw new ConflictException(`A board can have at most ${MAX_TEMPLATES} templates`);
        }
        await this.assertNameFree(tx, boardId, body.name);
        const template = await tx.cardTemplate.create({
          data: {
            boardId,
            name: body.name,
            title: body.title,
            priority: body.priority,
            notes: body.notes ?? null,
            labels: uniqueLabels(body.labels),
            cover: body.cover ?? null,
            checklist: body.checklist,
          },
        });
        return toTemplate(template);
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw nameTaken();
      throw error;
    }
  }

  async rename(id: string, userId: string, email: string, name: string): Promise<TemplateResponse> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const template = await this.findOwnedTemplate(tx, id, userId, email);
        await this.assertNameFree(tx, template.boardId, name, id);
        return toTemplate(await tx.cardTemplate.update({ where: { id }, data: { name } }));
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw nameTaken();
      throw error;
    }
  }

  async remove(id: string, userId: string, email: string): Promise<void> {
    await this.findOwnedTemplate(this.prisma, id, userId, email);
    await this.prisma.cardTemplate.deleteMany({ where: { id, board: boardAccessWhere(userId, email) } });
  }

  /**
   * Appends a new card built from the template to `listId`; a missing list, or one that is not on the template's
   * board, falls back to the board's first list. The checklist is unticked and there is no due date.
   */
  async createCardFromTemplate(id: string, userId: string, email: string, listId?: string): Promise<CardResponse> {
    return this.prisma.$transaction(async (tx) => {
      const template = await this.findOwnedTemplate(tx, id, userId, email);
      const lists = await tx.boardList.findMany({ where: { boardId: template.boardId }, orderBy: { position: "asc" } });
      const target = lists.find((list) => list.id === listId) ?? lists[0];
      if (!target) {
        throw new NotFoundException("List not found");
      }
      const position = await tx.card.count({ where: { listId: target.id } });
      const card = await tx.card.create({
        data: {
          listId: target.id,
          title: template.title,
          priority: template.priority,
          cover: template.cover,
          notes: template.notes,
          dueDate: null,
          position,
          labels: { create: uniqueLabels(template.labels).map((name, index) => ({ name, position: index })) },
          checklist: { create: template.checklist.map((text, index) => ({ text, done: false, position: index })) },
        },
        include: cardDetails,
      });
      return toCard(card);
    });
  }
}
