import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { BoardMembersResponse, Member } from "@adt/contracts";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { boardAccessWhere } from "./board-access.js";

const alreadyInvited = () => new ConflictException("This person already has access to the board");

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/** Who is on a board. Emails are not verified; membership grants no access to anything else yet. */
@Injectable()
export class MembersService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Loads a board through the owner or a member; for anyone else it is simply not found. */
  private async findBoard(boardId: string, userId: string, email: string) {
    const board = await this.prisma.board.findFirst({
      where: { AND: [{ id: boardId }, boardAccessWhere(userId, email)] },
      select: { id: true, userId: true, user: { select: { email: true } } },
    });
    if (!board) {
      throw new NotFoundException("Board not found");
    }
    return board;
  }

  private async findOwnedBoard(boardId: string, userId: string, email: string) {
    const board = await this.findBoard(boardId, userId, email);
    if (board.userId !== userId) {
      throw new ForbiddenException("Only the owner can do this");
    }
    return board;
  }

  async list(boardId: string, userId: string, email: string): Promise<BoardMembersResponse> {
    const board = await this.findBoard(boardId, userId, email);
    const members = await this.prisma.boardMember.findMany({
      where: { boardId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    return {
      owner: { email: board.user.email.toLowerCase() },
      members: members.map((m) => ({ id: m.id, email: m.email })),
    };
  }

  async invite(boardId: string, userId: string, email: string, inviteEmail: string): Promise<Member> {
    const board = await this.findOwnedBoard(boardId, userId, email);
    const target = inviteEmail.trim().toLowerCase();
    if (target === board.user.email.toLowerCase()) {
      throw new BadRequestException("You already own this board");
    }
    if (await this.prisma.boardMember.findUnique({ where: { boardId_email: { boardId, email: target } } })) {
      throw alreadyInvited();
    }
    try {
      const member = await this.prisma.boardMember.create({ data: { boardId, email: target } });
      return { id: member.id, email: member.email };
    } catch (error) {
      if (isUniqueViolation(error)) throw alreadyInvited();
      throw error;
    }
  }

  async remove(boardId: string, memberId: string, userId: string, email: string): Promise<void> {
    await this.findOwnedBoard(boardId, userId, email);
    // Scoped to this board, so a member id from another board is never touched.
    const { count } = await this.prisma.boardMember.deleteMany({ where: { id: memberId, boardId } });
    if (count === 0) {
      throw new NotFoundException("Member not found");
    }
  }

  async leave(boardId: string, userId: string, email: string): Promise<void> {
    const board = await this.findBoard(boardId, userId, email);
    if (board.userId === userId) {
      throw new BadRequestException("The owner can't leave");
    }
    await this.prisma.boardMember.deleteMany({ where: { boardId, email: email.toLowerCase() } });
  }
}
