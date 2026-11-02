import { Test } from "@nestjs/testing";
import { ConflictException, NotFoundException } from "@nestjs/common";
import { AppModule } from "../app.module.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { BoardsService, copyBoardName } from "./boards.service.js";

// Runs against the real local Postgres (docker compose up -d --wait db), like auth.spec.ts.
process.env.DATABASE_URL ??= "postgresql://kanban:kanban@localhost:5432/kanban";
const run = Math.random().toString(36).slice(2, 8);

describe("copyBoardName", () => {
  it("adds (copy), then (copy 2), (copy 3)", () => {
    expect(copyBoardName("Work", ["Work"])).toBe("Work (copy)");
    expect(copyBoardName("Work", ["Work", "Work (copy)"])).toBe("Work (copy 2)");
    expect(copyBoardName("Work", ["Work", "work (COPY)", "Work (copy 2)"])).toBe("Work (copy 3)");
  });

  it("truncates the base so the whole name stays within 40 characters", () => {
    const name = "x".repeat(40);
    const copy = copyBoardName(name, [name]);
    expect(copy).toBe(`${"x".repeat(33)} (copy)`);
    expect(copy.length).toBeLessThanOrEqual(40);
    const second = copyBoardName(name, [name, copy]);
    expect(second).toBe(`${"x".repeat(31)} (copy 2)`);
    expect(second.length).toBeLessThanOrEqual(40);
  });
});

describe("BoardsService", () => {
  let prisma: PrismaService;
  let service: BoardsService;
  let closeApp: () => Promise<void>;
  let alice: string;
  let bob: string;
  const emails = [`alice-${run}@boards-spec.test`, `bob-${run}@boards-spec.test`];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    closeApp = () => app.close();
    prisma = app.get(PrismaService);
    service = app.get(BoardsService);
    const [a, b] = await Promise.all(
      emails.map((email) => prisma.user.create({ data: { id: `${email}-id`, name: email, email } })),
    );
    alice = a.id;
    bob = b.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { endsWith: `-${run}@boards-spec.test` } } });
    await closeApp();
  });

  it("creates the default board once, with To do, Doing and Done in order", async () => {
    const [first, second] = await Promise.all([service.list(alice), service.list(alice)]);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(await service.list(alice)).toHaveLength(1);
    const board = await service.get(first[0].id, alice);
    expect(board.name).toBe("My board");
    expect(board.lists.map((l) => [l.name, l.position])).toEqual([["To do", 0], ["Doing", 1], ["Done", 2]]);
  });

  it("rejects duplicate names case-insensitively with 409, per user", async () => {
    // Names arrive trimmed: the validation pipe does that (see boards.controller.spec.ts).
    const board = await service.create(alice, "Plans");
    expect(board.name).toBe("Plans");
    await expect(service.create(alice, "PLANS")).rejects.toBeInstanceOf(ConflictException);
    // Another user may use the same name.
    await expect(service.create(bob, "Plans")).resolves.toMatchObject({ name: "Plans" });
  });

  it("lets a rename keep its own name, even in another case, but not take another board's", async () => {
    const board = await service.create(alice, "Rename me");
    await expect(service.rename(board.id, alice, "Rename me")).resolves.toMatchObject({ name: "Rename me" });
    await expect(service.rename(board.id, alice, "RENAME ME")).resolves.toMatchObject({ name: "RENAME ME" });
    await expect(service.rename(board.id, alice, "plans")).rejects.toBeInstanceOf(ConflictException);
  });

  it("duplicates a board with its lists and cards in order, under a unique name", async () => {
    const source = await service.create(alice, "Source");
    const list1 = await prisma.boardList.create({ data: { boardId: source.id, name: "B", position: 0 } });
    const list2 = await prisma.boardList.create({ data: { boardId: source.id, name: "A", position: 1 } });
    await prisma.card.createMany({
      data: [
        { listId: list1.id, title: "second", position: 1, priority: "high", dueDate: new Date("2026-03-04") },
        { listId: list1.id, title: "first", position: 0, notes: "n", cover: "red" },
        { listId: list2.id, title: "other", position: 0 },
      ],
    });

    const copy = await service.duplicate(source.id, alice);
    expect(copy.name).toBe("Source (copy)");
    expect((await service.duplicate(source.id, alice)).name).toBe("Source (copy 2)");

    const detail = await service.get(copy.id, alice);
    expect(detail.lists.map((l) => l.name)).toEqual(["B", "A"]);
    expect(detail.lists[0].cards.map((c) => c.title)).toEqual(["first", "second"]);
    expect(detail.lists[0].cards[0]).toMatchObject({ notes: "n", cover: "red", priority: "medium", dueDate: null });
    expect(detail.lists[0].cards[1]).toMatchObject({ priority: "high", dueDate: "2026-03-04" });
    expect(detail.lists[1].cards.map((c) => c.title)).toEqual(["other"]);
    expect(detail.lists[0].id).not.toBe(list1.id);
  });

  it("refuses to delete the last board and cascades the rest", async () => {
    const only = await service.create(bob, "Bob extra");
    const bobBoards = await service.list(bob);
    for (const board of bobBoards.filter((b) => b.id !== only.id)) {
      await service.remove(board.id, bob);
    }
    await expect(service.remove(only.id, bob)).rejects.toBeInstanceOf(ConflictException);
    expect(await service.list(bob)).toHaveLength(1);

    const second = await service.create(bob, "Bob second");
    const list = await prisma.boardList.create({ data: { boardId: second.id, name: "L", position: 0 } });
    await prisma.card.create({ data: { listId: list.id, title: "c", position: 0 } });
    await service.remove(second.id, bob);
    expect(await prisma.boardList.count({ where: { boardId: second.id } })).toBe(0);
    expect(await prisma.card.count({ where: { listId: list.id } })).toBe(0);
  });

  it("answers 404 and changes nothing for another user's board or an unknown id", async () => {
    const [mine] = await service.list(alice);
    await expect(service.get(mine.id, bob)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.rename(mine.id, bob, "Stolen")).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.duplicate(mine.id, bob)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.remove(mine.id, bob)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.get("does-not-exist", alice)).rejects.toBeInstanceOf(NotFoundException);
    const after = await service.get(mine.id, alice);
    expect(after.name).toBe("My board");
    expect(after.lists).toHaveLength(3);
  });
});
