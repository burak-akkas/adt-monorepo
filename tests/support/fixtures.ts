import { randomUUID } from "node:crypto";
import { expect, request as playwrightRequest, test as base, type APIRequestContext, type BrowserContext } from "@playwright/test";
import type { BoardDetail, ImportBoardRequest } from "@adt/contracts";

// Every test gets its own registered account, so parallel tests never share data.
// Requests go through the web origin (Next.js forwards /api/... to the API), as the browser does.
export const PASSWORD = "test-password-123";

export interface TestUser {
  email: string;
  password: string;
}

type SeedBoard = (board?: Partial<Omit<ImportBoardRequest, "importKey">>) => Promise<BoardDetail>;

interface Fixtures {
  user: TestUser;
  // Signed in as `user`.
  api: APIRequestContext;
  seedBoard: SeedBoard;
}

const DEFAULT_LISTS = [
  { id: "todo", name: "To do" },
  { id: "doing", name: "Doing" },
  { id: "done", name: "Done" },
];

async function register(api: APIRequestContext, user: TestUser): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    const res = await api.post("api/auth/sign-up/email", { data: { ...user, name: user.email } });
    if (res.status() === 429 && attempt === 0) {
      // The rate limiter asks to wait: do so once.
      const wait = Number(res.headers()["retry-after"]);
      await new Promise((resolve) => setTimeout(resolve, Number.isFinite(wait) && wait > 0 ? Math.min(wait, 60) * 1000 : 1000));
      continue;
    }
    expect(res.ok(), `sign-up failed with ${res.status()}: ${await res.text()}`).toBe(true);
    return;
  }
}

export const test = base.extend<Fixtures>({
  user: async ({}, use, testInfo) => {
    const suffix = `${testInfo.workerIndex}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
    await use({ email: `e2e-${suffix}@example.test`, password: PASSWORD });
  },

  api: async ({ baseURL, user }, use) => {
    const url = baseURL ?? "http://localhost:3000/";
    const api = await playwrightRequest.newContext({ baseURL: url, extraHTTPHeaders: { origin: new URL(url).origin } });
    await register(api, user);
    await use(api);
    await api.dispose();
  },

  // A browser context that is signed in as `user`. Created only when a test uses `page` or `context`.
  context: async ({ browser, api, baseURL }, use) => {
    const context: BrowserContext = await browser.newContext({ baseURL, storageState: await api.storageState() });
    await use(context);
    await context.close();
  },

  seedBoard: async ({ api }, use) => {
    const seed: SeedBoard = async (board = {}) => {
      const res = await api.post("api/boards/import", {
        data: { name: "Seeded board", lists: DEFAULT_LISTS, ...board, importKey: randomUUID() },
      });
      expect(res.ok(), `seeding failed with ${res.status()}: ${await res.text()}`).toBe(true);
      return ((await res.json()) as { board: BoardDetail }).board;
    };
    await use(seed);
  },
});

export { expect };
