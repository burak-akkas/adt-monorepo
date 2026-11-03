import { Test } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { AppModule } from "../app.module.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { LabelsService } from "../cards/labels.service.js";
import { ArchiveService } from "./archive.service.js";

// Runs against the real local Postgres (docker compose up -d --wait db).
// A is the owner, B an editor (a BoardMember row), C a non-member, D owns an unrelated board.
process.env.DATABASE_URL ??= "postgresql://kanban:kanban@localhost:5432/kanban";
const run = Math.random().toString(36).slice(2, 8);
const domain = "archive-labels-access-spec.test";
let seq = 0;

describe("labels and archive access: owner, editor and non-member", () => {
  let prisma: PrismaService;
  let archive: ArchiveService;
  let labels: LabelsService;
  let closeApp: () => Promise<void>;
  const ids: Record<"a" | "b" | "c" | "d", string> = { a: "", b: "", c: "", d: "" };
  const mail = (name: string) => `${name}-${run}@${domain}`;
  // B is invited with a lower-case address and acts with a mixed-case one.
  const who = {
    a: () => [ids.a, mail("a")] as const,
    b: () => [ids.b, mail("b").toUpperCase()] as const,
    c: () => [ids.c, mail("c")] as const,
  };

  const newBoard = async (userId: string, members: string[] = []) => {
    const board = await prisma.board.create({
      data: {
        userId,
        name: `Board ${seq++}`,
        lists: { create: ["To do", "Doing", "Done"].map((name, position) => ({ name, position })) },
        members: { create: members.map((email) => ({ email })) },
      },
      include: { lists: { orderBy: { position: "asc" } } },
    });
    return board;
  };
  const newCard = (listId: string, title: string) => prisma.card.create({ data: { listId, title, position: 0 } });
  const archived = async (boardId: string, listId: string, title: string) => {
    const card = await newCard(listId, title);
    await prisma.card.update({ where: { id: card.id }, data: { listId: null, boardId, archivedAt: new Date() } });
    return card;
  };
  // Everything owned by this spec's users, so parallel specs cannot interfere.
  const snapshot = async () => {
    const owners = { userId: { in: Object.values(ids) } };
    return {
      cards: await prisma.card.findMany({
        where: { OR: [{ list: { board: owners } }, { board: owners }] },
        orderBy: { id: "asc" },
      }),
      labels: await prisma.cardLabel.findMany({ where: { card: { OR: [{ list: { board: owners } }, { board: owners }] } }, orderBy: { id: "asc" } }),
    };
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    closeApp = () => app.close();
    prisma = app.get(PrismaService);
    archive = app.get(ArchiveService);
    labels = app.get(LabelsService);
    for (const key of ["a", "b", "c", "d"] as const) {
      const email = mail(key);
      ids[key] = (await prisma.user.create({ data: { id: `${email}-id`, name: email, email } })).id;
    }
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { endsWith: `-${run}@${domain}` } } });
    await closeApp();
  });

  describe.each(["a", "b"] as const)("as %s (owner / editor)", (role) => {
    it("adds and removes labels", async () => {
      const board = await newBoard(ids.a, [mail("b")]);
      const card = await newCard(board.lists[0].id, "card");
      const [userId, email] = who[role]();
      expect((await labels.add(card.id, userId, email, "Bug")).labels).toEqual(["Bug"]);
      expect((await labels.remove(card.id, userId, email, "bug")).labels).toEqual([]);
    });

    it("lists, archives, archives done, restores, deletes and empties the archive", async () => {
      const board = await newBoard(ids.a, [mail("b")]);
      const [todo, , done] = board.lists;
      const [userId, email] = who[role]();
      const live = await newCard(todo.id, "live");
      await newCard(done.id, "done");
      const kept = await archived(board.id, todo.id, "kept");
      const doomed = await archived(board.id, todo.id, "doomed");

      expect((await archive.list(board.id, userId, email)).map((c) => c.title).sort()).toEqual(["doomed", "kept"]);
      expect((await archive.archive(live.id, userId, email)).title).toBe("live");
      expect((await archive.archiveDone(board.id, userId, email)).map((c) => c.title)).toEqual(["done"]);
      expect(await archive.restore(kept.id, userId, email, todo.id)).toMatchObject({ id: kept.id, listId: todo.id });
      await archive.remove(doomed.id, userId, email);
      expect(await prisma.card.findUnique({ where: { id: doomed.id } })).toBeNull();
      await archive.empty(board.id, userId, email);
      expect(await archive.list(board.id, userId, email)).toEqual([]);
    });
  });

  it("gives a non-member 404 on every endpoint and changes nothing", async () => {
    const board = await newBoard(ids.a, [mail("b")]);
    const [todo, , done] = board.lists;
    const live = await newCard(todo.id, "live");
    await newCard(done.id, "done");
    const kept = await archived(board.id, todo.id, "kept");
    await prisma.cardLabel.create({ data: { cardId: live.id, name: "mine", position: 0 } });
    const [userId, email] = who.c();
    const before = await snapshot();

    const attempts = [
      () => labels.add(live.id, userId, email, "x"),
      () => labels.remove(live.id, userId, email, "mine"),
      () => archive.list(board.id, userId, email),
      () => archive.archive(live.id, userId, email),
      () => archive.archiveDone(board.id, userId, email),
      () => archive.restore(kept.id, userId, email),
      () => archive.remove(kept.id, userId, email),
      () => archive.empty(board.id, userId, email),
    ];
    for (const attempt of attempts) {
      await expect(attempt()).rejects.toBeInstanceOf(NotFoundException);
    }
    expect(await snapshot()).toEqual(before);
  });

  it("never touches another user's board when the owner or an editor acts", async () => {
    const mine = await newBoard(ids.a, [mail("b")]);
    const other = await newBoard(ids.d, [mail("c")]);
    const card = await newCard(other.lists[0].id, "theirs");
    await newCard(other.lists[2].id, "theirs done");
    const kept = await archived(other.id, other.lists[0].id, "theirs kept");
    const before = await snapshot();

    for (const role of ["a", "b"] as const) {
      const [userId, email] = who[role]();
      const attempts = [
        () => labels.add(card.id, userId, email, "x"),
        () => labels.remove(card.id, userId, email, "x"),
        () => archive.list(other.id, userId, email),
        () => archive.archive(card.id, userId, email),
        () => archive.archiveDone(other.id, userId, email),
        () => archive.restore(kept.id, userId, email),
        () => archive.remove(kept.id, userId, email),
        () => archive.empty(other.id, userId, email),
      ];
      for (const attempt of attempts) {
        await expect(attempt()).rejects.toBeInstanceOf(NotFoundException);
      }
    }
    expect(await snapshot()).toEqual(before);
    expect(mine.id).not.toBe(other.id);
  });

  it("does not let an editor of one board reach another board of the same owner", async () => {
    const shared = await newBoard(ids.a, [mail("b")]);
    const private_ = await newBoard(ids.a);
    const card = await newCard(private_.lists[0].id, "private");
    const [userId, email] = who.b();
    await expect(labels.add(card.id, userId, email, "x")).rejects.toBeInstanceOf(NotFoundException);
    await expect(archive.archive(card.id, userId, email)).rejects.toBeInstanceOf(NotFoundException);
    await expect(archive.list(private_.id, userId, email)).rejects.toBeInstanceOf(NotFoundException);
    expect(await archive.list(shared.id, userId, email)).toEqual([]);
  });
});
