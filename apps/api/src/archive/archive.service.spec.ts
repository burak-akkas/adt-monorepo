import { Test } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { archivedCardSchema, boardDetailSchema } from "@adt/contracts";
import { AppModule } from "../app.module.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { BoardsService } from "../boards/boards.service.js";
import { CardsService } from "../cards/cards.service.js";
import { ListsService } from "../lists/lists.service.js";
import { ArchiveService } from "./archive.service.js";

// Runs against the real local Postgres (docker compose up -d --wait db), like lists.service.spec.ts.
process.env.DATABASE_URL ??= "postgresql://kanban:kanban@localhost:5432/kanban";
const run = Math.random().toString(36).slice(2, 8);

describe("ArchiveService", () => {
  let prisma: PrismaService;
  let archive: ArchiveService;
  let boards: BoardsService;
  let cards: CardsService;
  let lists: ListsService;
  let closeApp: () => Promise<void>;
  let alice: string;
  let bob: string;
  const emails = [`alice-${run}@archive-spec.test`, `bob-${run}@archive-spec.test`];

  const newBoard = (userId: string, name: string, listNames: string[] = ["To do", "Doing", "Done"]) =>
    prisma.board.create({
      data: { userId, name, lists: { create: listNames.map((n, position) => ({ name: n, position })) } },
      include: { lists: { orderBy: { position: "asc" } } },
    });
  const addCards = async (listId: string, titles: string[]) => {
    const created = [];
    for (const [position, title] of titles.entries()) {
      created.push(await prisma.card.create({ data: { listId, title, position } }));
    }
    return created;
  };
  const inList = async (listId: string) =>
    (await prisma.card.findMany({ where: { listId }, orderBy: { position: "asc" } })).map((c) => [c.title, c.position]);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    closeApp = () => app.close();
    prisma = app.get(PrismaService);
    archive = app.get(ArchiveService);
    boards = app.get(BoardsService);
    cards = app.get(CardsService);
    lists = app.get(ListsService);
    const [a, b] = await Promise.all(emails.map((email) => prisma.user.create({ data: { id: `${email}-id`, name: email, email } })));
    alice = a.id;
    bob = b.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { endsWith: `-${run}@archive-spec.test` } } });
    await closeApp();
  });

  it("archives a card, keeps the source list dense and lists the archive oldest first", async () => {
    const board = await newBoard(alice, "One");
    const [todo] = board.lists;
    const [a, b, c] = await addCards(todo.id, ["a", "b", "c"]);

    const first = await archive.archive(b.id, alice);
    expect(archivedCardSchema.parse(first)).toMatchObject({ id: b.id, boardId: board.id, title: "b" });
    expect(await inList(todo.id)).toEqual([["a", 0], ["c", 1]]);
    const row = await prisma.card.findUniqueOrThrow({ where: { id: b.id } });
    expect(row).toMatchObject({ listId: null, boardId: board.id, position: 0 });
    expect(row.archivedAt).toBeInstanceOf(Date);

    await archive.archive(a.id, alice);
    expect(await inList(todo.id)).toEqual([["c", 0]]);
    await archive.archive(c.id, alice);
    expect((await archive.list(board.id, alice)).map((card) => card.title)).toEqual(["b", "a", "c"]);
  });

  it("archives all cards of the done list in order, and nothing when there is no done list", async () => {
    const board = await newBoard(alice, "Done");
    const [todo, , done] = board.lists;
    await addCards(todo.id, ["keep"]);
    await addCards(done.id, ["x", "y", "z"]);

    const archived = await archive.archiveDone(board.id, alice);
    expect(archived.map((card) => card.title)).toEqual(["x", "y", "z"]);
    expect((await archive.list(board.id, alice)).map((card) => card.title)).toEqual(["x", "y", "z"]);
    expect(await inList(done.id)).toEqual([]);
    expect(await inList(todo.id)).toEqual([["keep", 0]]);

    const plain = await newBoard(alice, "NoDone", ["One", "Two"]);
    await addCards(plain.lists[0].id, ["stay"]);
    expect(await archive.archiveDone(plain.id, alice)).toEqual([]);
    expect(await inList(plain.lists[0].id)).toEqual([["stay", 0]]);
  });

  it("uses the chosen done list from the board settings", async () => {
    const board = await newBoard(alice, "Chosen");
    const [todo] = board.lists;
    await addCards(todo.id, ["p", "q"]);
    await prisma.board.update({ where: { id: board.id }, data: { doneListId: todo.id } });
    expect((await archive.archiveDone(board.id, alice)).map((card) => card.title)).toEqual(["p", "q"]);
  });

  it("restores to a chosen list, the done list or the last list, appending at the end", async () => {
    const board = await newBoard(alice, "Restore");
    const [todo, doing, done] = board.lists;
    const [a, b, c] = await addCards(todo.id, ["a", "b", "c"]);
    await addCards(doing.id, ["d1", "d2"]);
    await addCards(done.id, ["e1"]);
    await archive.archive(a.id, alice);
    await archive.archive(b.id, alice);
    await archive.archive(c.id, alice);

    const chosen = await archive.restore(a.id, alice, doing.id);
    expect(chosen).toMatchObject({ id: a.id, listId: doing.id, position: 2 });
    expect(await prisma.card.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ boardId: null, archivedAt: null });

    expect(await archive.restore(b.id, alice)).toMatchObject({ listId: done.id, position: 1 });

    const noDone = await newBoard(alice, "RestoreLast", ["One", "Two"]);
    const [card] = await addCards(noDone.lists[0].id, ["only"]);
    await archive.archive(card.id, alice);
    expect(await archive.restore(card.id, alice)).toMatchObject({ listId: noDone.lists[1].id, position: 0 });

    expect((await archive.list(board.id, alice)).map((x) => x.title)).toEqual(["c"]);
    expect(await inList(doing.id)).toEqual([["d1", 0], ["d2", 1], ["a", 2]]);
  });

  it("answers 404 when restoring to a list of another board, a live card or a missing card", async () => {
    const board = await newBoard(alice, "Strict");
    const other = await newBoard(alice, "Other");
    const [a, live] = await addCards(board.lists[0].id, ["a", "live"]);
    await archive.archive(a.id, alice);
    await expect(archive.restore(a.id, alice, other.lists[0].id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(archive.restore(a.id, alice, "nope")).rejects.toBeInstanceOf(NotFoundException);
    await expect(archive.restore(live.id, alice)).rejects.toBeInstanceOf(NotFoundException);
    await expect(archive.restore("nope", alice)).rejects.toBeInstanceOf(NotFoundException);
    expect(await prisma.card.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ listId: null, boardId: board.id });
  });

  it("deletes one archived card permanently, never a live one, and empties only its own board's archive", async () => {
    const board = await newBoard(alice, "Delete");
    const other = await newBoard(alice, "Delete other");
    const [a, b, live] = await addCards(board.lists[0].id, ["a", "b", "live"]);
    const [o] = await addCards(other.lists[0].id, ["o"]);
    await archive.archive(a.id, alice);
    await archive.archive(b.id, alice);
    await archive.archive(o.id, alice);

    await archive.remove(a.id, alice);
    expect(await prisma.card.findUnique({ where: { id: a.id } })).toBeNull();
    await expect(archive.remove(a.id, alice)).rejects.toBeInstanceOf(NotFoundException);
    await expect(archive.remove(live.id, alice)).rejects.toBeInstanceOf(NotFoundException);
    expect(await prisma.card.findUnique({ where: { id: live.id } })).not.toBeNull();

    await archive.empty(board.id, alice);
    expect(await archive.list(board.id, alice)).toEqual([]);
    expect(await inList(board.lists[0].id)).toEqual([["live", 0]]);
    expect((await archive.list(other.id, alice)).map((card) => card.title)).toEqual(["o"]);
  });

  it("answers 404 and changes nothing for another user's board or card", async () => {
    const board = await newBoard(alice, "Private");
    const [live, kept] = await addCards(board.lists[0].id, ["live", "kept"]);
    await archive.archive(kept.id, alice);
    const done = await addCards(board.lists[2].id, ["done"]);

    await expect(archive.list(board.id, bob)).rejects.toBeInstanceOf(NotFoundException);
    await expect(archive.archive(live.id, bob)).rejects.toBeInstanceOf(NotFoundException);
    await expect(archive.archiveDone(board.id, bob)).rejects.toBeInstanceOf(NotFoundException);
    await expect(archive.restore(kept.id, bob)).rejects.toBeInstanceOf(NotFoundException);
    await expect(archive.remove(kept.id, bob)).rejects.toBeInstanceOf(NotFoundException);
    await expect(archive.empty(board.id, bob)).rejects.toBeInstanceOf(NotFoundException);

    expect(await prisma.card.findUniqueOrThrow({ where: { id: live.id } })).toMatchObject({ listId: board.lists[0].id });
    expect(await prisma.card.findUniqueOrThrow({ where: { id: kept.id } })).toMatchObject({ listId: null, boardId: board.id });
    expect(await inList(board.lists[2].id)).toEqual([[done[0].title, 0]]);
  });

  it("hides archived cards from lists and from the card endpoints", async () => {
    const board = await newBoard(alice, "Hidden");
    const [a] = await addCards(board.lists[0].id, ["a", "b"]);
    await archive.archive(a.id, alice);

    const detail = boardDetailSchema.parse(await boards.get(board.id, alice));
    expect(detail.lists[0].cards.map((card) => card.title)).toEqual(["b"]);
    expect(detail.archive.map((card) => card.title)).toEqual(["a"]);
    await expect(boards.get(board.id, bob)).rejects.toBeInstanceOf(NotFoundException);

    await expect(cards.get(a.id, alice)).rejects.toBeInstanceOf(NotFoundException);
    await expect(cards.update(a.id, alice, { title: "x" })).rejects.toBeInstanceOf(NotFoundException);
    await expect(cards.move(a.id, alice, board.lists[1].id, 0)).rejects.toBeInstanceOf(NotFoundException);
    await expect(cards.remove(a.id, alice)).rejects.toBeInstanceOf(NotFoundException);
    expect(await prisma.card.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ title: "a", listId: null });
  });

  it("survives list deletion and goes away with the board", async () => {
    const board = await newBoard(alice, "Lists");
    const [todo, doing] = board.lists;
    const [a, b] = await addCards(todo.id, ["a", "b"]);
    await archive.archive(a.id, alice);

    await lists.remove(todo.id, alice, doing.id);
    expect(await prisma.boardList.findUnique({ where: { id: todo.id } })).toBeNull();
    expect((await archive.list(board.id, alice)).map((card) => card.title)).toEqual(["a"]);
    expect(await inList(doing.id)).toEqual([["b", 0]]);
    expect(await prisma.card.findUniqueOrThrow({ where: { id: b.id } })).toMatchObject({ listId: doing.id });

    await newBoard(alice, "Spare");
    await boards.remove(board.id, alice);
    expect(await prisma.card.findUnique({ where: { id: a.id } })).toBeNull();
  });

  it("does not copy the archive when duplicating a board", async () => {
    const board = await newBoard(alice, "Dup");
    const [a] = await addCards(board.lists[0].id, ["a", "live"]);
    await archive.archive(a.id, alice);

    const copy = await boards.duplicate(board.id, alice);
    const detail = await boards.get(copy.id, alice);
    expect(detail.archive).toEqual([]);
    expect(detail.lists[0].cards.map((card) => card.title)).toEqual(["live"]);
    expect(await prisma.card.count({ where: { boardId: copy.id } })).toBe(0);
    expect((await archive.list(board.id, alice)).map((card) => card.title)).toEqual(["a"]);
  });
});
