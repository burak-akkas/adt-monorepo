import { Test } from "@nestjs/testing";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { AppModule } from "../app.module.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { CardsService } from "./cards.service.js";
import { AssigneesService } from "./assignees.service.js";

// Runs against the real local Postgres (docker compose up -d --wait db), like labels.service.spec.ts.
process.env.DATABASE_URL ??= "postgresql://kanban:kanban@localhost:5432/kanban";
const run = Math.random().toString(36).slice(2, 8);
let seq = 0;

describe("AssigneesService", () => {
  let prisma: PrismaService;
  let cards: CardsService;
  let service: AssigneesService;
  let closeApp: () => Promise<void>;
  let alice: string;
  let bob: string;
  const domain = `-${run}@assignees-spec.test`;
  const aliceEmail = `alice${domain}`;
  const bobEmail = `bob${domain}`;
  const memberEmail = `member${domain}`;

  /** Alice's board with one card; `memberEmail` is a member. */
  const newCard = async () => {
    const board = await prisma.board.create({
      data: {
        userId: alice,
        name: `B${seq++}`,
        lists: { create: [{ name: "L", position: 0 }] },
        members: { create: [{ email: memberEmail }] },
      },
      include: { lists: true },
    });
    return cards.create(board.lists[0].id, alice, aliceEmail, { title: "Card", priority: "medium" });
  };
  const activityTypes = async (cardId: string) =>
    (await prisma.cardActivity.findMany({ where: { cardId, type: { in: ["assigned", "unassigned"] } } })).map((a) => [a.type, a.to]);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    closeApp = () => app.close();
    prisma = app.get(PrismaService);
    cards = app.get(CardsService);
    service = app.get(AssigneesService);
    const [a, b] = await Promise.all(
      [aliceEmail, bobEmail].map((email) => prisma.user.create({ data: { id: `${email}-id`, name: email, email } })),
    );
    alice = a.id;
    bob = b.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { endsWith: domain } } });
    await closeApp();
  });

  it("assigns the owner and a member, storing lower-cased emails and recording activity", async () => {
    const card = await newCard();
    await service.add(card.id, alice, aliceEmail, ` ${aliceEmail.toUpperCase()} `);
    const updated = await service.add(card.id, alice, aliceEmail, memberEmail);
    expect(updated.assignees).toEqual([aliceEmail, memberEmail]);
    expect(await activityTypes(card.id)).toEqual(
      expect.arrayContaining([["assigned", aliceEmail], ["assigned", memberEmail]]),
    );
  });

  it("treats a repeated add as a no-op without activity", async () => {
    const card = await newCard();
    await service.add(card.id, alice, aliceEmail, memberEmail);
    const again = await service.add(card.id, alice, aliceEmail, memberEmail);
    expect(again.assignees).toEqual([memberEmail]);
    expect(await activityTypes(card.id)).toEqual([["assigned", memberEmail]]);
  });

  it("refuses someone who is not the owner or a member and changes nothing", async () => {
    const card = await newCard();
    await expect(service.add(card.id, alice, aliceEmail, "stranger@example.test")).rejects.toBeInstanceOf(BadRequestException);
    expect(await prisma.cardAssignee.count({ where: { cardId: card.id } })).toBe(0);
    expect(await activityTypes(card.id)).toEqual([]);
  });

  it("lets a member assign", async () => {
    const card = await newCard();
    const memberUser = await prisma.user.create({ data: { id: `${memberEmail}-id`, name: "m", email: memberEmail } });
    const updated = await service.add(card.id, memberUser.id, memberEmail, aliceEmail);
    expect(updated.assignees).toEqual([aliceEmail]);
  });

  it("removes an assignee recording activity only when something was deleted", async () => {
    const card = await newCard();
    await service.add(card.id, alice, aliceEmail, memberEmail);
    const removed = await service.remove(card.id, alice, aliceEmail, ` ${memberEmail.toUpperCase()}`);
    expect(removed.assignees).toEqual([]);
    const again = await service.remove(card.id, alice, aliceEmail, memberEmail);
    expect(again.assignees).toEqual([]);
    expect(await activityTypes(card.id)).toEqual([["assigned", memberEmail], ["unassigned", memberEmail]]);
  });

  it("gives another user's card a 404 and leaves it unchanged", async () => {
    const card = await newCard();
    await service.add(card.id, alice, aliceEmail, memberEmail);
    await expect(service.add(card.id, bob, bobEmail, bobEmail)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.remove(card.id, bob, bobEmail, memberEmail)).rejects.toBeInstanceOf(NotFoundException);
    expect((await cards.get(card.id, alice, aliceEmail)).assignees).toEqual([memberEmail]);
  });
});
