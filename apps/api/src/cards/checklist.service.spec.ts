import { Test } from "@nestjs/testing";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { AppModule } from "../app.module.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { CardsService } from "./cards.service.js";
import { ChecklistService } from "./checklist.service.js";

// Runs against the real local Postgres (docker compose up -d --wait db), like comments.service.spec.ts.
process.env.DATABASE_URL ??= "postgresql://kanban:kanban@localhost:5432/kanban";
const run = Math.random().toString(36).slice(2, 8);
let seq = 0;

describe("ChecklistService", () => {
  let prisma: PrismaService;
  let cards: CardsService;
  let service: ChecklistService;
  let closeApp: () => Promise<void>;
  let alice: string;
  let bob: string;
  const emails = [`alice-${run}@checklist-spec.test`, `bob-${run}@checklist-spec.test`];
  const [aliceEmail, bobEmail] = emails;

  const newCard = async (userId: string) => {
    const board = await prisma.board.create({
      data: { userId, name: `B${seq++}`, lists: { create: [{ name: "L", position: 0 }] } },
      include: { lists: true },
    });
    return cards.create(board.lists[0].id, userId, aliceEmail, { title: "Card", priority: "medium" });
  };
  const cardWithItems = async (userId: string, texts: string[]) => {
    const card = await newCard(userId);
    let updated = card;
    for (const text of texts) {
      updated = await service.add(card.id, userId, aliceEmail, text);
    }
    return updated;
  };
  const summary = (card: { checklist: { text: string; done: boolean }[] }) =>
    card.checklist.map((item) => `${item.text}${item.done ? "+" : "-"}`);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    closeApp = () => app.close();
    prisma = app.get(PrismaService);
    cards = app.get(CardsService);
    service = app.get(ChecklistService);
    const [a, b] = await Promise.all(
      emails.map((email) => prisma.user.create({ data: { id: `${email}-id`, name: email, email } })),
    );
    alice = a.id;
    bob = b.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { endsWith: `-${run}@checklist-spec.test` } } });
    await closeApp();
  });

  it("appends unticked items at the next position", async () => {
    const card = await cardWithItems(alice, ["a", "b", "c"]);
    expect(summary(card)).toEqual(["a-", "b-", "c-"]);
    const rows = await prisma.checklistItem.findMany({ where: { cardId: card.id }, orderBy: { position: "asc" } });
    expect(rows.map((r) => r.position)).toEqual([0, 1, 2]);
  });

  it("edits text and ticks or unticks explicitly", async () => {
    const card = await cardWithItems(alice, ["a", "b"]);
    const [first, second] = card.checklist.map((i) => i.id);
    expect(summary(await service.update(card.id, first, alice, aliceEmail, { done: true }))).toEqual(["a+", "b-"]);
    expect(summary(await service.update(card.id, first, alice, aliceEmail, { done: true }))).toEqual(["a+", "b-"]);
    expect(summary(await service.update(card.id, second, alice, aliceEmail, { text: "bb" }))).toEqual(["a+", "bb-"]);
    expect(summary(await service.update(card.id, first, alice, aliceEmail, { text: "aa", done: false }))).toEqual(["aa-", "bb-"]);
  });

  it("records checklistDone only when an item goes from not-done to done", async () => {
    const card = await cardWithItems(alice, ["a", "b"]);
    const [first, second] = card.checklist.map((i) => i.id);
    const entries = async () =>
      (await prisma.cardActivity.findMany({ where: { cardId: card.id, type: "checklistDone" }, orderBy: { at: "asc" } })).map((e) => e.to);

    await service.update(card.id, first, alice, aliceEmail, { text: "a2" });
    expect(await entries()).toEqual([]);

    await service.update(card.id, first, alice, aliceEmail, { done: true });
    expect(await entries()).toEqual(["a2"]);

    await service.update(card.id, first, alice, aliceEmail, { done: true });
    await service.update(card.id, first, alice, aliceEmail, { text: "a3" });
    await service.update(card.id, first, alice, aliceEmail, { done: false });
    expect(await entries()).toEqual(["a2"]);

    await service.update(card.id, second, alice, aliceEmail, { text: "bb", done: true });
    expect(await entries()).toEqual(["a2", "bb"]);
    expect((await cards.get(card.id, alice, aliceEmail)).activity[0]).toMatchObject({ type: "checklistDone", to: "bb" });
  });

  it("deletes an item and keeps positions dense", async () => {
    const card = await cardWithItems(alice, ["a", "b", "c"]);
    const after = await service.remove(card.id, card.checklist[1].id, alice, aliceEmail);
    expect(summary(after)).toEqual(["a-", "c-"]);
    const rows = await prisma.checklistItem.findMany({ where: { cardId: card.id }, orderBy: { position: "asc" } });
    expect(rows.map((r) => r.position)).toEqual([0, 1]);
  });

  it("reorders with the full list of ids and keeps positions dense", async () => {
    const card = await cardWithItems(alice, ["a", "b", "c"]);
    const [a, b, c] = card.checklist.map((i) => i.id);
    const after = await service.reorder(card.id, alice, aliceEmail, [c, a, b]);
    expect(summary(after)).toEqual(["c-", "a-", "b-"]);
    const rows = await prisma.checklistItem.findMany({ where: { cardId: card.id }, orderBy: { position: "asc" } });
    expect(rows.map((r) => r.position)).toEqual([0, 1, 2]);
  });

  it("reorders an empty checklist with an empty list", async () => {
    const card = await newCard(alice);
    expect((await service.reorder(card.id, alice, aliceEmail, [])).checklist).toEqual([]);
  });

  it("rejects reorder ids that are missing, extra, duplicated or foreign with 400", async () => {
    const card = await cardWithItems(alice, ["a", "b"]);
    const other = await cardWithItems(alice, ["x"]);
    const [a, b] = card.checklist.map((i) => i.id);
    const foreign = other.checklist[0].id;
    for (const ids of [[a], [a, b, "nope"], [a, a], [a, foreign], [], [a, b, a]]) {
      await expect(service.reorder(card.id, alice, aliceEmail, ids)).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(summary(await cards.get(card.id, alice, aliceEmail))).toEqual(["a-", "b-"]);
  });

  it("gives another user's card, or an item of a different card, a 404", async () => {
    const card = await cardWithItems(alice, ["mine"]);
    const other = await cardWithItems(alice, ["theirs"]);
    const itemId = card.checklist[0].id;

    await expect(service.add(card.id, bob, bobEmail, "x")).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.update(card.id, itemId, bob, bobEmail, { done: true })).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.remove(card.id, itemId, bob, bobEmail)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.reorder(card.id, bob, bobEmail, [itemId])).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.update(other.id, itemId, alice, aliceEmail, { done: true })).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.remove(other.id, itemId, alice, aliceEmail)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.update(card.id, "missing", alice, aliceEmail, { done: true })).rejects.toBeInstanceOf(NotFoundException);

    expect(summary(await cards.get(card.id, alice, aliceEmail))).toEqual(["mine-"]);
    expect(summary(await cards.get(other.id, alice, aliceEmail))).toEqual(["theirs-"]);
  });
});
