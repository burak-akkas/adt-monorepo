import { Test } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { AppModule } from "../app.module.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { CardsService } from "./cards.service.js";
import { CommentsService } from "./comments.service.js";

// Runs against the real local Postgres (docker compose up -d --wait db), like cards.service.spec.ts.
process.env.DATABASE_URL ??= "postgresql://kanban:kanban@localhost:5432/kanban";
const run = Math.random().toString(36).slice(2, 8);
let seq = 0;

describe("CommentsService", () => {
  let prisma: PrismaService;
  let cards: CardsService;
  let service: CommentsService;
  let closeApp: () => Promise<void>;
  let alice: string;
  let bob: string;
  const emails = [`alice-${run}@comments-spec.test`, `bob-${run}@comments-spec.test`];
  const [aliceEmail, bobEmail] = emails;

  const newCard = async (userId: string, title = "Card") => {
    const board = await prisma.board.create({
      data: { userId, name: `B${seq++}`, lists: { create: [{ name: "L", position: 0 }] } },
      include: { lists: true },
    });
    return cards.create(board.lists[0].id, userId, aliceEmail, { title, priority: "medium" });
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    closeApp = () => app.close();
    prisma = app.get(PrismaService);
    cards = app.get(CardsService);
    service = app.get(CommentsService);
    const [a, b] = await Promise.all(
      emails.map((email) => prisma.user.create({ data: { id: `${email}-id`, name: email, email } })),
    );
    alice = a.id;
    bob = b.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { endsWith: `-${run}@comments-spec.test` } } });
    await closeApp();
  });

  it("adds comments oldest first with createdAt and no editedAt", async () => {
    const card = await newCard(alice);
    await service.add(card.id, alice, aliceEmail, "first");
    const updated = await service.add(card.id, alice, aliceEmail, "second");
    expect(updated.comments.map((c) => c.text)).toEqual(["first", "second"]);
    for (const comment of updated.comments) {
      expect(Number.isNaN(Date.parse(comment.createdAt))).toBe(false);
      expect(comment.editedAt).toBeNull();
    }
  });

  it("sets editedAt only when the text changed", async () => {
    const card = await newCard(alice);
    const id = (await service.add(card.id, alice, aliceEmail, "hello")).comments[0].id;

    const same = await service.edit(card.id, id, alice, aliceEmail, "hello");
    expect(same.comments[0].editedAt).toBeNull();

    const changed = await service.edit(card.id, id, alice, aliceEmail, "hello again");
    expect(changed.comments[0]).toMatchObject({ id, text: "hello again" });
    expect(changed.comments[0].editedAt).not.toBeNull();
  });

  it("deletes a comment and returns the card", async () => {
    const card = await newCard(alice);
    const added = await service.add(card.id, alice, aliceEmail, "bye");
    const after = await service.remove(card.id, added.comments[0].id, alice, aliceEmail);
    expect(after.comments).toEqual([]);
    expect(await prisma.cardComment.count({ where: { cardId: card.id } })).toBe(0);
  });

  it("gives another user's card and comment, or a comment of a different card, a 404", async () => {
    const card = await newCard(alice);
    const other = await newCard(alice, "Other");
    const commentId = (await service.add(card.id, alice, aliceEmail, "mine")).comments[0].id;

    await expect(service.add(card.id, bob, bobEmail, "x")).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.edit(card.id, commentId, bob, bobEmail, "x")).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.remove(card.id, commentId, bob, bobEmail)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.edit(other.id, commentId, alice, aliceEmail, "x")).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.remove(other.id, commentId, alice, aliceEmail)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.edit(card.id, "missing", alice, aliceEmail, "x")).rejects.toBeInstanceOf(NotFoundException);

    expect((await cards.get(card.id, alice, aliceEmail)).comments.map((c) => [c.text, c.editedAt])).toEqual([["mine", null]]);
  });
});
