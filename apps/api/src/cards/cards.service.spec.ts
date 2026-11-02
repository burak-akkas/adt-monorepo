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

  describe("duplicate", () => {
    it("copies the details right after the original and keeps positions dense", async () => {
      const board = await newBoard(alice, "Dup", ["L"]);
      const listId = board.lists[0].id;
      const [a, , c] = await seed(listId, ["a", "b", "c"]);
      const full = await service.create(listId, alice, {
        title: "Full",
        priority: "high",
        cover: "teal",
        dueDate: "2026-12-31",
        notes: "some notes",
      });
      await prisma.cardLabel.createMany({
        data: [
          { cardId: full.id, name: "bug", position: 0 },
          { cardId: full.id, name: "ui", position: 1 },
        ],
      });
      await prisma.checklistItem.createMany({
        data: [
          { cardId: full.id, text: "one", done: true, position: 0 },
          { cardId: full.id, text: "two", done: false, position: 1 },
        ],
      });
      await prisma.cardComment.create({ data: { cardId: full.id, text: "hello" } });

      const copy = await service.duplicate(full.id, alice);
      expect(copy).toMatchObject({
        title: "Full (copy)",
        priority: "high",
        cover: "teal",
        dueDate: "2026-12-31",
        notes: "some notes",
        labels: ["bug", "ui"],
        listId,
        position: 4,
        comments: [],
      });
      expect(copy.id).not.toBe(full.id);
      expect(copy.checklist.map((i) => [i.text, i.done, i.position])).toEqual([["one", false, 0], ["two", false, 1]]);
      expect(copy.activity).toHaveLength(1);
      expect(copy.activity[0]).toMatchObject({ type: "duplicated", from: "Full" });
      expect(copy.activity[0]).not.toHaveProperty("to");
      // The original is untouched.
      const original = await service.get(full.id, alice);
      expect(original.checklist.map((i) => i.done)).toEqual([true, false]);
      expect(original.comments).toHaveLength(1);

      await service.duplicate(a.id, alice);
      expect(await order(listId)).toEqual([["a", 0], ["a (copy)", 1], ["b", 2], ["c", 3], ["Full", 4], ["Full (copy)", 5]]);
      await service.duplicate(c.id, alice);
      expect(await order(listId)).toEqual([
        ["a", 0], ["a (copy)", 1], ["b", 2], ["c", 3], ["c (copy)", 4], ["Full", 5], ["Full (copy)", 6],
      ]);
    });

    it("truncates a long title so it fits the limit with the suffix", async () => {
      const board = await newBoard(alice, "Dup long", ["L"]);
      const [card] = await seed(board.lists[0].id, ["x".repeat(120)]);
      const copy = await service.duplicate(card.id, alice);
      expect(copy.title).toHaveLength(120);
      expect(copy.title).toBe(`${"x".repeat(113)} (copy)`);
    });

    it("answers 404 for another user's card or an archived card, and changes nothing", async () => {
      const board = await newBoard(alice, "Dup 404", ["L"]);
      const listId = board.lists[0].id;
      const [card, other] = await seed(listId, ["mine", "gone"]);
      await expect(service.duplicate(card.id, bob)).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.duplicate("does-not-exist", alice)).rejects.toBeInstanceOf(NotFoundException);
      await prisma.card.update({ where: { id: other.id }, data: { listId: null, boardId: board.id, archivedAt: new Date(), position: 0 } });
      await expect(service.duplicate(other.id, alice)).rejects.toBeInstanceOf(NotFoundException);
      expect(await order(listId)).toEqual([["mine", 0]]);
      expect(await prisma.card.count({ where: { boardId: board.id } })).toBe(1);
    });
  });

  describe("activity", () => {
    const log = async (cardId: string) => (await prisma.cardActivity.findMany({ where: { cardId } })).length;

    it("records created, and moved with list ids only on a list change", async () => {
      const board = await newBoard(alice, "Act move", ["From", "To"]);
      const [from, to] = board.lists;
      const card = await service.create(from.id, alice, { title: "c", priority: "medium" });
      expect(card.activity).toMatchObject([{ type: "created" }]);
      expect(card.activity[0]).not.toHaveProperty("from");

      await service.move(card.id, alice, from.id, 0);
      expect(await log(card.id)).toBe(1);

      const moved = await service.move(card.id, alice, to.id, 0);
      expect(moved.activity.map((a) => a.type)).toEqual(["moved", "created"]);
      expect(moved.activity[0]).toMatchObject({ from: from.id, to: to.id });
    });

    it("records old/new values, omits empty sides, and logs notes without text, newest first", async () => {
      const board = await newBoard(alice, "Act update", ["L"]);
      const card = await service.create(board.lists[0].id, alice, { title: "Old", priority: "low" });
      const updated = await service.update(card.id, alice, {
        title: "New",
        priority: "high",
        dueDate: "2026-05-06",
        notes: "some secret text",
      });
      expect(updated.activity.map((a) => a.type)).toEqual(["description", "dueDate", "priority", "title", "created"]);
      const [description, dueDate, priority, title] = updated.activity;
      expect(description).not.toHaveProperty("from");
      expect(description).not.toHaveProperty("to");
      expect(dueDate).toEqual(expect.objectContaining({ to: "2026-05-06" }));
      expect(dueDate).not.toHaveProperty("from");
      expect(priority).toMatchObject({ from: "low", to: "high" });
      expect(title).toMatchObject({ from: "Old", to: "New" });

      const cleared = await service.update(card.id, alice, { dueDate: null });
      expect(cleared.activity[0]).toMatchObject({ type: "dueDate", from: "2026-05-06" });
      expect(cleared.activity[0]).not.toHaveProperty("to");
    });

    it("writes nothing when nothing changed", async () => {
      const board = await newBoard(alice, "Act noop", ["L"]);
      const card = await service.create(board.lists[0].id, alice, { title: "Same", priority: "low", dueDate: "2026-01-01" });
      await service.update(card.id, alice, {});
      await service.update(card.id, alice, { title: "Same", priority: "low", dueDate: "2026-01-01", cover: "red" });
      await service.update(card.id, alice, { notes: "" });
      await service.update(card.id, alice, { notes: null });
      expect(await log(card.id)).toBe(1);
    });

    it("keeps at most 50 entries, dropping the oldest", async () => {
      const board = await newBoard(alice, "Act cap", ["L"]);
      const card = await service.create(board.lists[0].id, alice, { title: "t0", priority: "low" });
      for (let i = 1; i <= 55; i++) await service.update(card.id, alice, { title: `t${i}` });
      expect(await log(card.id)).toBe(50);
      const result = await service.get(card.id, alice);
      expect(result.activity).toHaveLength(50);
      expect(result.activity[0]).toMatchObject({ type: "title", to: "t55" });
      expect(result.activity.at(-1)).toMatchObject({ type: "title", to: "t6" });
    });

    it("writes nothing for another user's card", async () => {
      const board = await newBoard(alice, "Act owner", ["A", "B"]);
      const card = await service.create(board.lists[0].id, alice, { title: "mine", priority: "low" });
      await expect(service.update(card.id, bob, { title: "x" })).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.move(card.id, bob, board.lists[1].id, 0)).rejects.toBeInstanceOf(NotFoundException);
      expect(await log(card.id)).toBe(1);
    });

    it("rolls the entry back with the change when the move fails", async () => {
      const board = await newBoard(alice, "Act rollback", ["A"]);
      const other = await newBoard(alice, "Act rollback 2", ["B"]);
      const card = await service.create(board.lists[0].id, alice, { title: "mine", priority: "low" });
      await expect(service.move(card.id, alice, other.lists[0].id, 0)).rejects.toBeInstanceOf(NotFoundException);
      expect(await log(card.id)).toBe(1);
    });
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
