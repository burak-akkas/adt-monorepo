import { Test } from "@nestjs/testing";
import { ConflictException, NotFoundException } from "@nestjs/common";
import { AppModule } from "../app.module.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { CardsService } from "./cards.service.js";
import { LabelsService } from "./labels.service.js";

// Runs against the real local Postgres (docker compose up -d --wait db), like cards.service.spec.ts.
process.env.DATABASE_URL ??= "postgresql://kanban:kanban@localhost:5432/kanban";
const run = Math.random().toString(36).slice(2, 8);
let seq = 0;

describe("LabelsService", () => {
  let prisma: PrismaService;
  let cards: CardsService;
  let service: LabelsService;
  let closeApp: () => Promise<void>;
  let alice: string;
  let bob: string;
  const emails = [`alice-${run}@labels-spec.test`, `bob-${run}@labels-spec.test`];
  const [aliceEmail, bobEmail] = emails;

  const newCard = async (userId: string) => {
    const board = await prisma.board.create({
      data: { userId, name: `B${seq++}`, lists: { create: [{ name: "L", position: 0 }] } },
      include: { lists: true },
    });
    return cards.create(board.lists[0].id, userId, userId === bob ? bobEmail : aliceEmail, { title: "Card", priority: "medium" });
  };
  const positions = async (cardId: string) =>
    (await prisma.cardLabel.findMany({ where: { cardId }, orderBy: { position: "asc" } })).map((l) => [l.name, l.position]);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    closeApp = () => app.close();
    prisma = app.get(PrismaService);
    cards = app.get(CardsService);
    service = app.get(LabelsService);
    const [a, b] = await Promise.all(
      emails.map((email) => prisma.user.create({ data: { id: `${email}-id`, name: email, email } })),
    );
    alice = a.id;
    bob = b.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { endsWith: `-${run}@labels-spec.test` } } });
    await closeApp();
  });

  it("adds labels keeping spelling and order", async () => {
    const card = await newCard(alice);
    await service.add(card.id, alice, aliceEmail, "Bug");
    await service.add(card.id, alice, aliceEmail, "urgent");
    const updated = await service.add(card.id, alice, aliceEmail, "Front End");
    expect(updated.labels).toEqual(["Bug", "urgent", "Front End"]);
  });

  it("answers 409 for a case-insensitive duplicate on the same card only", async () => {
    const card = await newCard(alice);
    const other = await newCard(alice);
    await service.add(card.id, alice, aliceEmail, "bug");
    await expect(service.add(card.id, alice, aliceEmail, "Bug")).rejects.toBeInstanceOf(ConflictException);
    expect((await cards.get(card.id, alice, aliceEmail)).labels).toEqual(["bug"]);
    expect((await service.add(other.id, alice, aliceEmail, "Bug")).labels).toEqual(["Bug"]);
  });

  it("removes ignoring case and surrounding spaces, keeping positions dense", async () => {
    const card = await newCard(alice);
    for (const name of ["a", "Bug", "c"]) await service.add(card.id, alice, aliceEmail, name);
    const updated = await service.remove(card.id, alice, aliceEmail, "  bUG ");
    expect(updated.labels).toEqual(["a", "c"]);
    expect(await positions(card.id)).toEqual([["a", 0], ["c", 1]]);
  });

  it("treats removing an unknown label as a no-op", async () => {
    const card = await newCard(alice);
    await service.add(card.id, alice, aliceEmail, "a");
    expect((await service.remove(card.id, alice, aliceEmail, "zzz")).labels).toEqual(["a"]);
  });

  it("gives another user's card a 404 and leaves it unchanged", async () => {
    const card = await newCard(alice);
    await service.add(card.id, alice, aliceEmail, "mine");
    await expect(service.add(card.id, bob, bobEmail, "x")).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.remove(card.id, bob, bobEmail, "mine")).rejects.toBeInstanceOf(NotFoundException);
    expect((await cards.get(card.id, alice, aliceEmail)).labels).toEqual(["mine"]);
  });
});
