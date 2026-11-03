import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, UseGuards } from "@nestjs/common";
import {
  inviteMemberRequestSchema,
  type BoardMembersResponse,
  type InviteMemberRequest,
  type Member,
} from "@adt/contracts";
import { SessionGuard, UserEmail, UserId } from "../auth/session.guard.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { MembersService } from "./members.service.js";

@Controller("boards/:boardId/members")
@UseGuards(SessionGuard)
export class MembersController {
  constructor(@Inject(MembersService) private readonly members: MembersService) {}

  @Get()
  list(
    @UserId() userId: string,
    @UserEmail() email: string,
    @Param("boardId") boardId: string,
  ): Promise<BoardMembersResponse> {
    return this.members.list(boardId, userId, email);
  }

  @Post()
  invite(
    @UserId() userId: string,
    @UserEmail() email: string,
    @Param("boardId") boardId: string,
    @Body(new ZodValidationPipe(inviteMemberRequestSchema)) body: InviteMemberRequest,
  ): Promise<Member> {
    return this.members.invite(boardId, userId, email, body.email);
  }

  // Declared before `:memberId`, so "me" is not read as a member id.
  @Delete("me")
  @HttpCode(204)
  async leave(
    @UserId() userId: string,
    @UserEmail() email: string,
    @Param("boardId") boardId: string,
  ): Promise<void> {
    await this.members.leave(boardId, userId, email);
  }

  @Delete(":memberId")
  @HttpCode(204)
  async remove(
    @UserId() userId: string,
    @UserEmail() email: string,
    @Param("boardId") boardId: string,
    @Param("memberId") memberId: string,
  ): Promise<void> {
    await this.members.remove(boardId, memberId, userId, email);
  }
}
