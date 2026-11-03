import { Test } from "@nestjs/testing";
import { ConflictException, NotFoundException } from "@nestjs/common";
import { MAX_TEMPLATES } from "@adt/contracts";
import { AppModule } from "../app.module.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { TemplatesService } from "./templates.service.js";

// Runs against the real local Postgres (docker compose up -d --wait db), like boards.service.spec.ts.
process.env.DATABASE_URL ??= "postgresql://kanban:kanban@localhost:5432/kanban";
const run = Math.random().toString(36).slice(2, 8);

describe("TemplatesService", () => {
  let prisma: PrismaService;
  let service: TemplatesService;
  let closeApp: () => Promise<void>;
  let alice: string;
  let bob: string;
  const emails = [`alice-${run}@templates-spec.test`, `bob-${run}@templates-spec.test`];
  const [aliceEmail, bobEmail] = emails;

  const newBoard = (userId: string, name: string, lists: string[] = ["To do", "Doing"]) =>
    prisma.board.create({
      data: { userId, name, lists: { create: lists.map((n, position) => ({ name: n, position })) } },
      include: { lists: { orderBy: { position: "asc" } } },
    });
  const body = (name: string, extra: object = {}) => ({
    name,
    title: "Title",
    priority: "medium" as const,
    labels: [],
    checklist: [],
    ...extra,
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    closeApp = () => app.close();
    prisma = app.get(PrismaService);
    service = app.get(TemplatesService);
    const [a, b] = await Promise.all(
      emails.map((email) => prisma.user.create({ data: { id: `${email}-id`, name: email, email } })),
    );
    alice = a.id;
    bob = b.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { endsWith: `-${run}@templates-spec.test` } } });
    await closeApp();
  });

  it("creates, lists, renames and deletes templates, keeping the card fields without done flag or due date", async () => {
    const board = await newBoard(alice, "CRUD");
    const created = await service.create(board.id, alice, aliceEmail, {
      ...body("Bug report", { notes: "steps", cover: "red", priority: "high" }),
      labels: ["bug", "BUG", "ui"],
      checklist: ["reproduce", "fix"],
    });
    expect(created).toMatchObject({
      boardId: board.id,
      name: "Bug report",
      title: "Title",
      priority: "high",
      notes: "steps",
      cover: "red",
      labels: ["bug", "ui"],
      checklist: ["reproduce", "fix"],
    });
    expect(created).not.toHaveProperty("dueDate");
    await service.create(board.id, alice, aliceEmail, body("Second"));
    expect((await service.list(board.id, alice, aliceEmail)).map((t) => t.name)).toEqual(["Bug report", "Second"]);

    expect(await service.rename(created.id, alice, aliceEmail, "Renamed")).toMatchObject({ id: created.id, name: "Renamed" });
    await service.remove(created.id, alice, aliceEmail);
    expect((await service.list(board.id, alice, aliceEmail)).map((t) => t.name)).toEqual(["Second"]);
  });

  it("rejects a taken name ignoring case with 409, but lets a rename keep its own name; other boards may reuse it", async () => {
    const board = await newBoard(alice, "Names");
    const first = await service.create(board.id, alice, aliceEmail, body("Alpha"));
    const second = await service.create(board.id, alice, aliceEmail, body("Beta"));
    await expect(service.create(board.id, alice, aliceEmail, body("ALPHA"))).rejects.toBeInstanceOf(ConflictException);
    await expect(service.rename(second.id, alice, aliceEmail, "alpha")).rejects.toBeInstanceOf(ConflictException);
    await expect(service.rename(first.id, alice, aliceEmail, "ALPHA")).resolves.toMatchObject({ name: "ALPHA" });
    const other = await newBoard(alice, "Names 2");
    await expect(service.create(other.id, alice, aliceEmail, body("alpha"))).resolves.toMatchObject({ name: "alpha" });
  });

  it("backs name uniqueness with a case-insensitive unique index", async () => {
    const board = await newBoard(alice, "Index");
    await prisma.cardTemplate.create({ data: { boardId: board.id, name: "Same", title: "t" } });
    await expect(prisma.cardTemplate.create({ data: { boardId: board.id, name: "SAME", title: "t" } })).rejects.toMatchObject({
      code: "P2002",
    });
  });

  it("allows at most 30 templates per board and answers 409 for the 31st", async () => {
    const board = await newBoard(alice, "Limit");
    await prisma.cardTemplate.createMany({
      data: Array.from({ length: MAX_TEMPLATES }, (_, i) => ({ boardId: board.id, name: `T${i}`, title: "t" })),
    });
    await expect(service.create(board.id, alice, aliceEmail, body("One too many"))).rejects.toThrow(/at most 30/);
    await expect(service.create(board.id, alice, aliceEmail, body("One too many"))).rejects.toBeInstanceOf(ConflictException);
    expect(await prisma.cardTemplate.count({ where: { boardId: board.id } })).toBe(MAX_TEMPLATES);
    // Deleting one makes room again.
    const [first] = await service.list(board.id, alice, aliceEmail);
    await service.remove(first.id, alice, aliceEmail);
    await expect(service.create(board.id, alice, aliceEmail, body("Fits now"))).resolves.toMatchObject({ name: "Fits now" });
  });

  it("creates a card in the given list: appended, dense positions, unticked checklist, labels, no due date", async () => {
    const board = await newBoard(alice, "From template");
    const [todo, doing] = board.lists;
    await prisma.card.createMany({
      data: [
        { listId: doing.id, title: "a", position: 0 },
        { listId: doing.id, title: "b", position: 1 },
      ],
    });
    const template = await service.create(board.id, alice, aliceEmail, {
      ...body("Full", { notes: "n", cover: "teal", priority: "low" }),
      labels: ["x", "y"],
      checklist: ["one", "two"],
    });

    const card = await service.createCardFromTemplate(template.id, alice, aliceEmail, doing.id);
    expect(card).toMatchObject({
      listId: doing.id,
      title: "Title",
      priority: "low",
      notes: "n",
      cover: "teal",
      dueDate: null,
      position: 2,
      labels: ["x", "y"],
      comments: [],
    });
    expect(card.checklist.map((i) => [i.text, i.done, i.position])).toEqual([["one", false, 0], ["two", false, 1]]);
    const positions = (await prisma.card.findMany({ where: { listId: doing.id }, orderBy: { position: "asc" } })).map((c) => c.position);
    expect(positions).toEqual([0, 1, 2]);
    expect(await prisma.card.count({ where: { listId: todo.id } })).toBe(0);
  });

  it("falls back to the first list for a missing, unknown or foreign list, and never touches the foreign one", async () => {
    const board = await newBoard(alice, "Fallback");
    const foreign = await newBoard(alice, "Foreign");
    const template = await service.create(board.id, alice, aliceEmail, body("T"));

    expect(await service.createCardFromTemplate(template.id, alice, aliceEmail)).toMatchObject({ listId: board.lists[0].id, position: 0 });
    expect(await service.createCardFromTemplate(template.id, alice, aliceEmail, "nope")).toMatchObject({ listId: board.lists[0].id, position: 1 });
    expect(await service.createCardFromTemplate(template.id, alice, aliceEmail, foreign.lists[0].id)).toMatchObject({
      listId: board.lists[0].id,
      position: 2,
    });
    expect(await prisma.card.count({ where: { listId: { in: foreign.lists.map((l) => l.id) } } })).toBe(0);
  });

  it("answers 404 and changes nothing for another user's board or template", async () => {
    const board = await newBoard(alice, "Private");
    const template = await service.create(board.id, alice, aliceEmail, body("Mine"));

    await expect(service.list(board.id, bob, bobEmail)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.create(board.id, bob, bobEmail, body("Stolen"))).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.rename(template.id, bob, bobEmail, "Stolen")).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.remove(template.id, bob, bobEmail)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.createCardFromTemplate(template.id, bob, bobEmail, board.lists[0].id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.rename("does-not-exist", alice, aliceEmail, "x")).rejects.toBeInstanceOf(NotFoundException);

    expect((await service.list(board.id, alice, aliceEmail)).map((t) => t.name)).toEqual(["Mine"]);
    expect(await prisma.card.count({ where: { listId: board.lists[0].id } })).toBe(0);
  });

  it("lets a member use the templates of a shared board, and stops at once when they are removed", async () => {
    const board = await newBoard(alice, "Shared");
    const template = await service.create(board.id, alice, aliceEmail, body("Mine"));
    await prisma.boardMember.create({ data: { boardId: board.id, email: bobEmail } });

    expect((await service.list(board.id, bob, bobEmail.toUpperCase())).map((t) => t.name)).toEqual(["Mine"]);
    const theirs = await service.create(board.id, bob, bobEmail, body("Theirs"));
    await expect(service.rename(theirs.id, bob, bobEmail, "Theirs 2")).resolves.toMatchObject({ name: "Theirs 2" });
    await expect(service.createCardFromTemplate(template.id, bob, bobEmail)).resolves.toMatchObject({ listId: board.lists[0].id });
    await service.remove(theirs.id, bob, bobEmail);

    await prisma.boardMember.deleteMany({ where: { boardId: board.id } });
    await expect(service.list(board.id, bob, bobEmail)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.remove(template.id, bob, bobEmail)).rejects.toBeInstanceOf(NotFoundException);
    expect(await prisma.cardTemplate.count({ where: { boardId: board.id } })).toBe(1);
  });

  it("deletes the templates with their board", async () => {
    const board = await newBoard(bob, "Doomed");
    await service.create(board.id, bob, bobEmail, body("Gone"));
    await prisma.board.delete({ where: { id: board.id } });
    expect(await prisma.cardTemplate.count({ where: { boardId: board.id } })).toBe(0);
  });
});
