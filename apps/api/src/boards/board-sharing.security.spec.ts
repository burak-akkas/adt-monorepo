import { Test } from "@nestjs/testing";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { boardSummarySchema } from "@adt/contracts";
import request from "supertest";
import { AppModule } from "../app.module.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { mountAuth } from "../auth/auth.module.js";

// Security matrix for sharing: every boards, lists and templates endpoint, for the owner (user a), an editor (user b,
// invited by email) and a non-member (user b on a board that is not shared). Runs against the real local Postgres
// with real sessions. The users play the roles of a@example.test and b@example.test.
process.env.DATABASE_URL ??= "postgresql://kanban:kanban@localhost:5432/kanban";
const ORIGIN = "http://localhost:3000";
const PASSWORD = "test-password-123";
const run = Math.random().toString(36).slice(2, 8);
const email = (name: string) => `${name}-${run}@sharing-spec.test`;

type Fixture = { boardId: string; l1: string; l2: string; cardId: string; templateId: string };
type Call = { method: "get" | "post" | "patch" | "put" | "delete"; path: string; body?: object };
type Endpoint = {
  name: string;
  call: (fx: Fixture) => Call;
  owner: number;
  /** Status for an editor; anything but 2xx must leave the data untouched. */
  editor: number;
};

const templateBody = { name: "New template", title: "T", priority: "medium", labels: [], checklist: [] };

const endpoints: Endpoint[] = [
  { name: "GET /boards/:id", call: (fx) => ({ method: "get", path: `/boards/${fx.boardId}` }), owner: 200, editor: 200 },
  {
    name: "PATCH /boards/:id (rename)",
    call: (fx) => ({ method: "patch", path: `/boards/${fx.boardId}`, body: { name: "Renamed board" } }),
    owner: 200,
    editor: 404,
  },
  {
    name: "PATCH /boards/:id/settings",
    call: (fx) => ({ method: "patch", path: `/boards/${fx.boardId}/settings`, body: { view: "board" } }),
    owner: 200,
    editor: 200,
  },
  { name: "POST /boards/:id/duplicate", call: (fx) => ({ method: "post", path: `/boards/${fx.boardId}/duplicate` }), owner: 201, editor: 404 },
  { name: "DELETE /boards/:id", call: (fx) => ({ method: "delete", path: `/boards/${fx.boardId}` }), owner: 204, editor: 404 },
  {
    name: "POST /boards/:id/lists",
    call: (fx) => ({ method: "post", path: `/boards/${fx.boardId}/lists`, body: { name: "New list" } }),
    owner: 201,
    editor: 201,
  },
  {
    name: "PATCH /lists/:id",
    call: (fx) => ({ method: "patch", path: `/lists/${fx.l1}`, body: { name: "Renamed list" } }),
    owner: 200,
    editor: 200,
  },
  {
    name: "POST /lists/:id/move",
    call: (fx) => ({ method: "post", path: `/lists/${fx.l1}/move`, body: { position: 1 } }),
    owner: 200,
    editor: 200,
  },
  {
    name: "PUT /lists/:id/wip-limit",
    call: (fx) => ({ method: "put", path: `/lists/${fx.l1}/wip-limit`, body: { limit: 3 } }),
    owner: 200,
    editor: 200,
  },
  {
    name: "PUT /lists/:id/cards/order",
    call: (fx) => ({ method: "put", path: `/lists/${fx.l1}/cards/order`, body: { cardIds: [fx.cardId] } }),
    owner: 200,
    editor: 200,
  },
  { name: "POST /lists/:id/archive", call: (fx) => ({ method: "post", path: `/lists/${fx.l1}/archive` }), owner: 200, editor: 200 },
  {
    name: "DELETE /lists/:id",
    call: (fx) => ({ method: "delete", path: `/lists/${fx.l1}?moveTo=${fx.l2}` }),
    owner: 204,
    editor: 204,
  },
  { name: "GET /boards/:id/templates", call: (fx) => ({ method: "get", path: `/boards/${fx.boardId}/templates` }), owner: 200, editor: 200 },
  {
    name: "POST /boards/:id/templates",
    call: (fx) => ({ method: "post", path: `/boards/${fx.boardId}/templates`, body: templateBody }),
    owner: 201,
    editor: 201,
  },
  {
    name: "PATCH /templates/:id",
    call: (fx) => ({ method: "patch", path: `/templates/${fx.templateId}`, body: { name: "Renamed template" } }),
    owner: 200,
    editor: 200,
  },
  { name: "DELETE /templates/:id", call: (fx) => ({ method: "delete", path: `/templates/${fx.templateId}` }), owner: 204, editor: 204 },
  {
    name: "POST /templates/:id/cards",
    call: (fx) => ({ method: "post", path: `/templates/${fx.templateId}/cards`, body: {} }),
    owner: 201,
    editor: 201,
  },
];

describe("board sharing: owner, editor and non-member", () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let cookies: Record<"a" | "b", string>;
  let ids: Record<"a" | "b", string>;

  const signUp = async (name: string) => {
    const res = await request(app.getHttpServer())
      .post("/auth/sign-up/email")
      .set("Origin", ORIGIN)
      .send({ name, email: email(name), password: PASSWORD })
      .expect(200);
    return (res.headers["set-cookie"] as unknown as string[]).map((c) => c.split(";")[0]).join("; ");
  };
  const send = (who: "a" | "b", { method, path, body }: Call) => {
    const req = request(app.getHttpServer())[method](path).set("Cookie", cookies[who]);
    return body === undefined ? req : req.send(body);
  };

  /** A board of user a with two lists, a card in the first, and a template. */
  const newFixture = async (name: string, sharedWith?: string): Promise<Fixture> => {
    const board = await prisma.board.create({
      data: {
        userId: ids.a,
        name: `${name} ${Math.random()}`,
        lists: { create: [{ name: "L1", position: 0 }, { name: "L2", position: 1 }] },
        templates: { create: [{ name: "Template", title: "t" }] },
        ...(sharedWith ? { members: { create: [{ email: sharedWith }] } } : {}),
      },
      include: { lists: { orderBy: { position: "asc" } }, templates: true },
    });
    const card = await prisma.card.create({ data: { listId: board.lists[0].id, title: "card", position: 0 } });
    return { boardId: board.id, l1: board.lists[0].id, l2: board.lists[1].id, cardId: card.id, templateId: board.templates[0].id };
  };

  /** Everything of user a's data these endpoints can change. */
  const snapshot = async () => {
    const boards = await prisma.board.findMany({
      where: { userId: ids.a },
      orderBy: { name: "asc" },
      select: {
        name: true,
        view: true,
        lists: { orderBy: { position: "asc" }, select: { name: true, position: true, wipLimit: true, cards: { select: { id: true, archivedAt: true } } } },
        templates: { orderBy: { name: "asc" }, select: { name: true } },
        members: { select: { email: true } },
      },
    });
    return { boards, cards: await prisma.card.count({ where: { OR: [{ list: { board: { userId: ids.a } } }, { board: { userId: ids.a } }] } }) };
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
    mountAuth(app);
    await app.init();
    prisma = app.get(PrismaService);
    cookies = { a: await signUp("a"), b: await signUp("b") };
    const [a, b] = await Promise.all([email("a"), email("b")].map((e) => prisma.user.findUniqueOrThrow({ where: { email: e } })));
    ids = { a: a.id, b: b.id };
    // Both users own a second board, so the "last board" rule never decides these results.
    await prisma.board.createMany({
      data: [
        { userId: ids.a, name: "A other" },
        { userId: ids.b, name: "B own" },
      ],
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { endsWith: `-${run}@sharing-spec.test` } } });
    await app.close();
  });

  it("needs a session on every endpoint", async () => {
    const fx = await newFixture("Anon");
    for (const endpoint of endpoints) {
      const { method, path, body } = endpoint.call(fx);
      const req = request(app.getHttpServer())[method](path);
      await (body === undefined ? req : req.send(body)).expect(401);
    }
  });

  describe.each(endpoints)("$name", (endpoint) => {
    it("works for the owner", async () => {
      const fx = await newFixture("Owner");
      await send("a", endpoint.call(fx)).expect(endpoint.owner);
    });

    it(`answers ${endpoint.editor} for an editor`, async () => {
      const fx = await newFixture("Editor", email("b"));
      const before = await snapshot();
      await send("b", endpoint.call(fx)).expect(endpoint.editor);
      if (endpoint.editor === 404) {
        expect(await snapshot()).toEqual(before);
      }
    });

    it("answers 404 for a non-member and changes nothing", async () => {
      const fx = await newFixture("Private");
      const before = await snapshot();
      await send("b", endpoint.call(fx)).expect(404);
      expect(await snapshot()).toEqual(before);
    });

    it("answers 404 for a former member", async () => {
      const fx = await newFixture("Removed", email("b"));
      await prisma.boardMember.deleteMany({ where: { boardId: fx.boardId } });
      const before = await snapshot();
      await send("b", endpoint.call(fx)).expect(404);
      expect(await snapshot()).toEqual(before);
    });
  });

  it("lists shared boards with role editor, owned boards with role owner, and never other boards", async () => {
    const shared = await newFixture("Listed", email("b"));
    const hidden = await newFixture("Hidden");

    const bobs = ((await send("b", { method: "get", path: "/boards" }).expect(200)).body as unknown[]).map((b) => boardSummarySchema.parse(b));
    expect(bobs.find((b) => b.id === shared.boardId)?.role).toBe("editor");
    expect(bobs.find((b) => b.name === "B own")?.role).toBe("owner");
    expect(bobs.some((b) => b.id === hidden.boardId)).toBe(false);

    const alices = ((await send("a", { method: "get", path: "/boards" }).expect(200)).body as unknown[]).map((b) => boardSummarySchema.parse(b));
    expect(alices.find((b) => b.id === shared.boardId)?.role).toBe("owner");
    expect(alices.find((b) => b.id === hidden.boardId)?.role).toBe("owner");
  });

  it("returns the role on GET /boards/:id", async () => {
    const fx = await newFixture("Role", email("b"));
    const detail = (await send("b", { method: "get", path: `/boards/${fx.boardId}` }).expect(200)).body as { role: string };
    expect(detail.role).toBe("editor");
  });

  it("keeps board names unique per owner only", async () => {
    const fx = await newFixture("Names", email("b"));
    const name = (await prisma.board.findUniqueOrThrow({ where: { id: fx.boardId } })).name;
    // The editor may create their own board with the shared board's name; the owner may not repeat it.
    await send("b", { method: "post", path: "/boards", body: { name } }).expect(201);
    await send("a", { method: "post", path: "/boards", body: { name } }).expect(409);
  });

  it("does not let an editor listing their boards touch the owner's boards", async () => {
    const before = await snapshot();
    await send("b", { method: "get", path: "/boards" }).expect(200);
    expect(await snapshot()).toEqual(before);
  });
});
