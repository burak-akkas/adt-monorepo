import { Test } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { AppModule } from "../app.module.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { CardsService } from "./cards.service.js";

// Runs against the real local Postgres (docker compose up -d --wait db), like lists.service.spec.ts.
process.env.DATABASE_URL ??= "postgresql://kanban:kanban@localhost:5432/kanban";
const run = Math.random().toString(36).slice(2, 8);

describe("CardsService", () => {
  let prisma: PrismaService;
  let service: CardsService;
  let closeApp: () => Promise<void>;
  let alice: string;
  let bob: string;
  const emails = [`alice-${run}@cards-spec.test`, `bob-${run}@cards-spec.test`];

  const newBoard = async (userId: string, name: string, lists: string[]) =>
    prisma.board.create({
      data: { userId, name, lists: { create: lists.map((n, position) => ({ name: n, position })) } },
      include: { lists: { orderBy: { position: "asc" } } },
    });
  const order = async (listId: string) =>
    (await prisma.card.findMany({ where: { listId }, orderBy: { position: "asc" } })).map((c) => [c.title, c.position]);
  const seed = async (listId: string, titles: string[]) => {
    const cards = [];
    for (const title of titles) cards.push(await service.create(listId, alice, { title, priority: "medium" }));
    return cards;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    closeApp = () => app.close();
    prisma = app.get(PrismaService);
    service = app.get(CardsService);
    const [a, b] = await Promise.all(
      emails.map((email) => prisma.user.create({ data: { id: `${email}-id`, name: email, email } })),
    );
    alice = a.id;
    bob = b.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { endsWith: `-${run}@cards-spec.test` } } });
    await closeApp();
  });

  it("creates cards at the end with optional fields and a server-set createdAt", async () => {
    const board = await newBoard(alice, "Create", ["L"]);
    const listId = board.lists[0].id;
    const first = await service.create(listId, alice, { title: "One", priority: "medium" });
    expect(first).toMatchObject({ title: "One", priority: "medium", cover: null, dueDate: null, notes: null, position: 0, listId });
    expect(Number.isNaN(Date.parse(first.createdAt))).toBe(false);
    const second = await service.create(listId, alice, {
      title: "Two",
      priority: "high",
      cover: "teal",
      dueDate: "2026-12-31",
      notes: "hello",
    });
    expect(second).toMatchObject({ position: 1, priority: "high", cover: "teal", dueDate: "2026-12-31", notes: "hello" });
    expect(await service.get(second.id, alice)).toEqual(second);
  });

  it("updates only the present keys and clears with null", async () => {
    const board = await newBoard(alice, "Update", ["L"]);
    const card = await service.create(board.lists[0].id, alice, {
      title: "Old",
      priority: "low",
      cover: "red",
      dueDate: "2026-01-02",
      notes: "n",
    });
    const renamed = await service.update(card.id, alice, { title: "New", priority: "high" });
    expect(renamed).toMatchObject({ title: "New", priority: "high", cover: "red", dueDate: "2026-01-02", notes: "n" });
    const cleared = await service.update(card.id, alice, { cover: null, dueDate: null, notes: null });
    expect(cleared).toMatchObject({ title: "New", cover: null, dueDate: null, notes: null });
    expect(await service.update(card.id, alice, { dueDate: "2027-03-04" })).toMatchObject({ dueDate: "2027-03-04" });
  });

  it("closes the gap when a card is deleted", async () => {
    const board = await newBoard(alice, "Delete", ["L"]);
    const listId = board.lists[0].id;
    const [a, b, c] = await seed(listId, ["a", "b", "c"]);
    await service.remove(b.id, alice);
    expect(await order(listId)).toEqual([["a", 0], ["c", 1]]);
    await service.remove(a.id, alice);
    await service.remove(c.id, alice);
    expect(await order(listId)).toEqual([]);
  });

  it("moves within a list: forward, backward, to 0 and past the end", async () => {
    const board = await newBoard(alice, "Within", ["L"]);
    const listId = board.lists[0].id;
    const [a, b, c, d] = await seed(listId, ["a", "b", "c", "d"]);
    await service.move(a.id, alice, listId, 2);
    expect(await order(listId)).toEqual([["b", 0], ["c", 1], ["a", 2], ["d", 3]]);
    await service.move(d.id, alice, listId, 0);
    expect(await order(listId)).toEqual([["d", 0], ["b", 1], ["c", 2], ["a", 3]]);
    expect(await service.move(b.id, alice, listId, 99)).toMatchObject({ position: 3 });
    expect(await order(listId)).toEqual([["d", 0], ["c", 1], ["a", 2], ["b", 3]]);
    await service.move(c.id, alice, listId, 1);
    expect(await order(listId)).toEqual([["d", 0], ["c", 1], ["a", 2], ["b", 3]]);
  });

  it("moves across lists of the same board, keeping both lists dense and ordered", async () => {
    const board = await newBoard(alice, "Across", ["From", "To"]);
    const [from, to] = board.lists;
    const [, b] = await seed(from.id, ["a", "b", "c"]);
    await seed(to.id, ["x", "y"]);
    const moved = await service.move(b.id, alice, to.id, 1);
    expect(moved).toMatchObject({ listId: to.id, position: 1 });
    expect(await order(from.id)).toEqual([["a", 0], ["c", 1]]);
    expect(await order(to.id)).toEqual([["x", 0], ["b", 1], ["y", 2]]);
  });

  it("rejects a list on another board or of another user, and changes nothing", async () => {
    const board = await newBoard(alice, "Mine", ["A"]);
    const other = await newBoard(alice, "Other board", ["B"]);
    const bobs = await newBoard(bob, "Bobs", ["C"]);
    const [card] = await seed(board.lists[0].id, ["keep"]);
    await seed(other.lists[0].id, ["there"]);

    await expect(service.move(card.id, alice, other.lists[0].id, 0)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.move(card.id, alice, bobs.lists[0].id, 0)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.move(card.id, alice, "does-not-exist", 0)).rejects.toBeInstanceOf(NotFoundException);
    expect(await order(board.lists[0].id)).toEqual([["keep", 0]]);
    expect(await order(other.lists[0].id)).toEqual([["there", 0]]);
    expect(await order(bobs.lists[0].id)).toEqual([]);
  });

  it("answers 404 and changes nothing for another user's list or card", async () => {
    const board = await newBoard(alice, "Private", ["A", "B"]);
    const [a, b] = board.lists;
    const [card] = await seed(a.id, ["secret"]);
    await expect(service.create(a.id, bob, { title: "Stolen", priority: "medium" })).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.get(card.id, bob)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.update(card.id, bob, { title: "Stolen" })).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.move(card.id, bob, b.id, 0)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.remove(card.id, bob)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.get("does-not-exist", alice)).rejects.toBeInstanceOf(NotFoundException);
    expect(await order(a.id)).toEqual([["secret", 0]]);
    expect(await order(b.id)).toEqual([]);
  });
});
