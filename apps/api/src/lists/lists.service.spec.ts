import { Test } from "@nestjs/testing";
import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { AppModule } from "../app.module.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { ListsService } from "./lists.service.js";

// Runs against the real local Postgres (docker compose up -d --wait db), like boards.service.spec.ts.
process.env.DATABASE_URL ??= "postgresql://kanban:kanban@localhost:5432/kanban";
const run = Math.random().toString(36).slice(2, 8);

describe("ListsService", () => {
  let prisma: PrismaService;
  let service: ListsService;
  let closeApp: () => Promise<void>;
  let alice: string;
  let bob: string;
  const emails = [`alice-${run}@lists-spec.test`, `bob-${run}@lists-spec.test`];
  const [aliceEmail, bobEmail] = emails;

  const newBoard = async (userId: string, name: string, lists: string[] = []) =>
    prisma.board.create({
      data: { userId, name, lists: { create: lists.map((n, position) => ({ name: n, position })) } },
      include: { lists: { orderBy: { position: "asc" } } },
    });
  const order = async (boardId: string) =>
    (await prisma.boardList.findMany({ where: { boardId }, orderBy: { position: "asc" } })).map((l) => [l.name, l.position]);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    closeApp = () => app.close();
    prisma = app.get(PrismaService);
    service = app.get(ListsService);
    const [a, b] = await Promise.all(
      emails.map((email) => prisma.user.create({ data: { id: `${email}-id`, name: email, email } })),
    );
    alice = a.id;
    bob = b.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { endsWith: `-${run}@lists-spec.test` } } });
    await closeApp();
  });

  it("appends new lists at the end", async () => {
    const board = await newBoard(alice, "Append");
    expect(await service.create(board.id, alice, aliceEmail, "One")).toMatchObject({ name: "One", position: 0, boardId: board.id });
    expect(await service.create(board.id, alice, aliceEmail, "Two")).toMatchObject({ position: 1 });
    expect(await service.create(board.id, alice, aliceEmail, "Three")).toMatchObject({ position: 2 });
  });

  it("rejects duplicate names case-insensitively with 409, but lets a rename keep its own name", async () => {
    const board = await newBoard(alice, "Names", ["Alpha", "Beta"]);
    const [alpha] = board.lists;
    await expect(service.create(board.id, alice, aliceEmail, "ALPHA")).rejects.toBeInstanceOf(ConflictException);
    await expect(service.rename(alpha.id, alice, aliceEmail, "beta")).rejects.toBeInstanceOf(ConflictException);
    await expect(service.rename(alpha.id, alice, aliceEmail, "Alpha")).resolves.toMatchObject({ name: "Alpha" });
    await expect(service.rename(alpha.id, alice, aliceEmail, "ALPHA")).resolves.toMatchObject({ name: "ALPHA" });
    // Another board may reuse the name.
    const other = await newBoard(alice, "Names 2");
    await expect(service.create(other.id, alice, aliceEmail, "alpha")).resolves.toMatchObject({ name: "alpha" });
  });

  it("moves a list to the start, middle, end and past the end, keeping positions dense", async () => {
    const board = await newBoard(alice, "Move", ["A", "B", "C", "D"]);
    const [a, , , d] = board.lists;
    await service.move(d.id, alice, aliceEmail, 0);
    expect(await order(board.id)).toEqual([["D", 0], ["A", 1], ["B", 2], ["C", 3]]);
    await service.move(d.id, alice, aliceEmail, 2);
    expect(await order(board.id)).toEqual([["A", 0], ["B", 1], ["D", 2], ["C", 3]]);
    const result = await service.move(a.id, alice, aliceEmail, 99);
    expect(result.map((l) => [l.name, l.position])).toEqual([["B", 0], ["D", 1], ["C", 2], ["A", 3]]);
    expect(await order(board.id)).toEqual([["B", 0], ["D", 1], ["C", 2], ["A", 3]]);
  });

  it("refuses to delete the last list", async () => {
    const board = await newBoard(alice, "Last", ["Only"]);
    await expect(service.remove(board.lists[0].id, alice, aliceEmail)).rejects.toBeInstanceOf(ConflictException);
    expect(await order(board.id)).toEqual([["Only", 0]]);
  });

  it("deletes an empty list without a target and closes the gap", async () => {
    const board = await newBoard(alice, "Empty", ["A", "B", "C"]);
    await service.remove(board.lists[1].id, alice, aliceEmail);
    expect(await order(board.id)).toEqual([["A", 0], ["C", 1]]);
  });

  it("moves the cards to the target in order when deleting a list with cards", async () => {
    const board = await newBoard(alice, "Cards", ["A", "B", "C"]);
    const [a, b, c] = board.lists;
    await prisma.card.createMany({
      data: [
        { listId: a.id, title: "a2", position: 1 },
        { listId: a.id, title: "a1", position: 0 },
        { listId: c.id, title: "c0", position: 0 },
        { listId: c.id, title: "c1", position: 1 },
      ],
    });
    await service.remove(a.id, alice, aliceEmail, c.id);
    const cards = await prisma.card.findMany({ where: { listId: c.id }, orderBy: { position: "asc" } });
    expect(cards.map((x) => [x.title, x.position])).toEqual([["c0", 0], ["c1", 1], ["a1", 2], ["a2", 3]]);
    expect(await order(board.id)).toEqual([["B", 0], ["C", 1]]);
    expect(await prisma.card.count({ where: { listId: b.id } })).toBe(0);
  });

  it("rejects a missing or invalid target and changes nothing", async () => {
    const board = await newBoard(alice, "Targets", ["A", "B"]);
    const [a, b] = board.lists;
    const foreign = await newBoard(alice, "Targets other", ["X", "Y"]);
    const bobs = await newBoard(bob, "Bob targets", ["Z", "W"]);
    await prisma.card.create({ data: { listId: a.id, title: "keep", position: 0 } });

    await expect(service.remove(a.id, alice, aliceEmail)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.remove(a.id, alice, aliceEmail, a.id)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.remove(a.id, alice, aliceEmail, foreign.lists[0].id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.remove(a.id, alice, aliceEmail, bobs.lists[0].id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.remove(a.id, alice, aliceEmail, "does-not-exist")).rejects.toBeInstanceOf(NotFoundException);

    expect(await order(board.id)).toEqual([["A", 0], ["B", 1]]);
    expect(await prisma.card.count({ where: { listId: a.id } })).toBe(1);
    expect(await prisma.card.count({ where: { listId: b.id } })).toBe(0);
    expect(await prisma.card.count({ where: { listId: bobs.lists[0].id } })).toBe(0);
  });

  it("answers 404 and changes nothing for another user's board or list", async () => {
    const board = await newBoard(alice, "Private", ["A", "B"]);
    const [a, b] = board.lists;
    await expect(service.create(board.id, bob, bobEmail, "Stolen")).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.rename(a.id, bob, bobEmail, "Stolen")).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.move(a.id, bob, bobEmail, 1)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.remove(a.id, bob, bobEmail)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.remove(a.id, bob, bobEmail, b.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.create("does-not-exist", alice, aliceEmail, "x")).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.rename("does-not-exist", alice, aliceEmail, "x")).rejects.toBeInstanceOf(NotFoundException);
    expect(await order(board.id)).toEqual([["A", 0], ["B", 1]]);
  });

  it("lets a member edit the lists of a shared board, and stops at once when they are removed", async () => {
    const board = await newBoard(alice, "Shared", ["A", "B"]);
    const [a] = board.lists;
    await prisma.boardMember.create({ data: { boardId: board.id, email: bobEmail } });

    const created = await service.create(board.id, bob, bobEmail.toUpperCase(), "C");
    expect(created).toMatchObject({ name: "C", position: 2 });
    await expect(service.rename(a.id, bob, bobEmail, "A2")).resolves.toMatchObject({ name: "A2" });
    await expect(service.setWipLimit(a.id, bob, bobEmail, 4)).resolves.toMatchObject({ wipLimit: 4 });
    await service.move(created.id, bob, bobEmail, 0);
    expect(await order(board.id)).toEqual([["C", 0], ["A2", 1], ["B", 2]]);

    await prisma.boardMember.deleteMany({ where: { boardId: board.id } });
    await expect(service.rename(a.id, bob, bobEmail, "Gone")).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.create(board.id, bob, bobEmail, "D")).rejects.toBeInstanceOf(NotFoundException);
    expect(await order(board.id)).toEqual([["C", 0], ["A2", 1], ["B", 2]]);
  });

  it("records one archived entry per card when archiving a list, and none for an empty list", async () => {
    const board = await newBoard(alice, "ArchiveActivity", ["One", "Two"]);
    const [one, two] = board.lists;
    await prisma.card.createMany({
      data: [
        { listId: one.id, title: "a", position: 0 },
        { listId: one.id, title: "b", position: 1 },
      ],
    });
    const archived = await service.archiveCards(one.id, alice, aliceEmail);
    expect(archived.map((card) => card.activity.map((entry) => entry.type))).toEqual([["archived"], ["archived"]]);
    expect(await prisma.cardActivity.count({ where: { card: { boardId: board.id }, type: "archived" } })).toBe(2);
    expect(await service.archiveCards(two.id, alice, aliceEmail)).toEqual([]);
    expect(await prisma.cardActivity.count({ where: { card: { boardId: board.id } } })).toBe(2);
  });

  it("sets and clears a WIP limit", async () => {
    const board = await newBoard(alice, "Wip", ["A"]);
    const [a] = board.lists;
    expect(a).toMatchObject({ wipLimit: null, collapsed: false });
    await expect(service.setWipLimit(a.id, alice, aliceEmail, 3)).resolves.toMatchObject({ wipLimit: 3 });
    await expect(service.setWipLimit(a.id, alice, aliceEmail, null)).resolves.toMatchObject({ wipLimit: null });
  });

  it("answers 404 and leaves another user's list limit unchanged", async () => {
    const board = await newBoard(alice, "Wip private", ["A"]);
    const [a] = board.lists;
    await service.setWipLimit(a.id, alice, aliceEmail, 5);
    await expect(service.setWipLimit(a.id, bob, bobEmail, 1)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.setWipLimit("does-not-exist", alice, aliceEmail, 1)).rejects.toBeInstanceOf(NotFoundException);
    expect((await prisma.boardList.findUniqueOrThrow({ where: { id: a.id } })).wipLimit).toBe(5);
  });

  it("returns the limit and collapsed flag on create, rename and move", async () => {
    const board = await newBoard(alice, "Shape", ["A"]);
    const created = await service.create(board.id, alice, aliceEmail, "B");
    expect(created).toMatchObject({ wipLimit: null, collapsed: false });
    expect(await service.rename(created.id, alice, aliceEmail, "C")).toMatchObject({ wipLimit: null, collapsed: false });
    expect((await service.move(created.id, alice, aliceEmail, 0))[0]).toMatchObject({ wipLimit: null, collapsed: false });
  });

  it("on delete keeps the last name, drops the limit and clears the insights lists", async () => {
    const board = await newBoard(alice, "Former", ["Keep", "Gone"]);
    const [keep, gone] = board.lists;
    await service.setWipLimit(gone.id, alice, aliceEmail, 2);
    await prisma.boardList.update({ where: { id: gone.id }, data: { collapsed: true } });
    await prisma.board.update({ where: { id: board.id }, data: { doingListId: gone.id, doneListId: keep.id } });

    await service.remove(gone.id, alice, aliceEmail);

    expect(await prisma.boardList.findUnique({ where: { id: gone.id } })).toBeNull();
    const after = await prisma.board.findUniqueOrThrow({ where: { id: board.id }, include: { formerLists: true } });
    expect(after.doingListId).toBeNull();
    expect(after.doneListId).toBe(keep.id);
    expect(after.formerLists).toEqual([{ boardId: board.id, listId: gone.id, name: "Gone" }]);
  });
});
