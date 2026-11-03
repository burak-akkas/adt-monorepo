import { Test } from "@nestjs/testing";
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { AppModule } from "../app.module.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { MembersService } from "./members.service.js";

// Runs against the real local Postgres (docker compose up -d --wait db), like templates.service.spec.ts.
process.env.DATABASE_URL ??= "postgresql://kanban:kanban@localhost:5432/kanban";
const run = Math.random().toString(36).slice(2, 8);

describe("MembersService", () => {
  let prisma: PrismaService;
  let service: MembersService;
  let closeApp: () => Promise<void>;
  let owner: { id: string; email: string };
  let member: { id: string; email: string };
  let outsider: { id: string; email: string };
  let boardId: string;
  let otherBoardId: string;
  const domain = `-${run}@members-spec.test`;

  const makeUser = (name: string) => {
    const email = `${name}${domain}`;
    return prisma.user.create({ data: { id: `${email}-id`, name, email } });
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    closeApp = () => app.close();
    prisma = app.get(PrismaService);
    service = app.get(MembersService);
    owner = await makeUser("a");
    member = await makeUser("b");
    outsider = await makeUser("c");
  });

  beforeEach(async () => {
    await prisma.board.deleteMany({ where: { userId: { in: [owner.id, outsider.id] } } });
    boardId = (await prisma.board.create({ data: { userId: owner.id, name: "Shared" } })).id;
    otherBoardId = (await prisma.board.create({ data: { userId: outsider.id, name: "Other" } })).id;
    await prisma.boardMember.create({ data: { boardId, email: member.email } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { endsWith: domain } } });
    await closeApp();
  });

  describe("list", () => {
    it("shows the owner and the members to the owner and to a member", async () => {
      for (const who of [owner, member]) {
        const result = await service.list(boardId, who.id, who.email);
        expect(result.owner).toEqual({ email: owner.email });
        expect(result.members.map((m) => m.email)).toEqual([member.email]);
      }
    });

    it("answers 404 to a non-member", async () => {
      await expect(service.list(boardId, outsider.id, outsider.email)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("invite", () => {
    it("lets the owner invite, storing the email lower-cased", async () => {
      const added = await service.invite(boardId, owner.id, owner.email, "New.Person@Example.Test");
      expect(added.email).toBe("new.person@example.test");
      expect((await service.list(boardId, owner.id, owner.email)).members.map((m) => m.email)).toContain(
        "new.person@example.test",
      );
    });

    it("rejects the owner's own email, in any case", async () => {
      await expect(service.invite(boardId, owner.id, owner.email, owner.email.toUpperCase())).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it("rejects a duplicate, ignoring case", async () => {
      await expect(service.invite(boardId, owner.id, owner.email, member.email.toUpperCase())).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it("answers 403 to a member and 404 to a non-member", async () => {
      await expect(service.invite(boardId, member.id, member.email, "x@example.test")).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(service.invite(boardId, outsider.id, outsider.email, "x@example.test")).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(await prisma.boardMember.count({ where: { boardId } })).toBe(1);
    });
  });

  describe("remove", () => {
    it("lets the owner remove a member", async () => {
      const row = await prisma.boardMember.findFirstOrThrow({ where: { boardId } });
      await service.remove(boardId, row.id, owner.id, owner.email);
      expect(await prisma.boardMember.count({ where: { boardId } })).toBe(0);
    });

    it("answers 403 to a member and 404 to a non-member, removing nothing", async () => {
      const row = await prisma.boardMember.findFirstOrThrow({ where: { boardId } });
      await expect(service.remove(boardId, row.id, member.id, member.email)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.remove(boardId, row.id, outsider.id, outsider.email)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(await prisma.boardMember.count({ where: { boardId } })).toBe(1);
    });

    it("never touches a member id from another board", async () => {
      const foreign = await prisma.boardMember.create({ data: { boardId: otherBoardId, email: "z@example.test" } });
      await expect(service.remove(boardId, foreign.id, owner.id, owner.email)).rejects.toBeInstanceOf(NotFoundException);
      expect(await prisma.boardMember.count({ where: { id: foreign.id } })).toBe(1);
    });
  });

  describe("leave", () => {
    it("lets a member leave, only on that board", async () => {
      await prisma.boardMember.create({ data: { boardId: otherBoardId, email: member.email } });
      await service.leave(boardId, member.id, member.email);
      expect(await prisma.boardMember.count({ where: { boardId } })).toBe(0);
      expect(await prisma.boardMember.count({ where: { boardId: otherBoardId } })).toBe(1);
    });

    it("refuses the owner and answers 404 to a non-member", async () => {
      await expect(service.leave(boardId, owner.id, owner.email)).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.leave(boardId, outsider.id, outsider.email)).rejects.toBeInstanceOf(NotFoundException);
      expect(await prisma.boardMember.count({ where: { boardId } })).toBe(1);
    });
  });

  it("removes the members when the board is deleted", async () => {
    await prisma.board.delete({ where: { id: boardId } });
    expect(await prisma.boardMember.count({ where: { boardId } })).toBe(0);
  });
});
