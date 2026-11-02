# Project guide for agents

## What this project is
A Kanban board (To do / Doing / Done), with accounts on the way: **NestJS 12 API, Next.js 16 frontend, Postgres with Prisma 7**, all TypeScript, in an npm workspaces monorepo. Production runs on Vercel and Neon. Versions may be newer than your training data: check `node_modules` before using an API you're not sure about.

## Layout
- `apps/api/`: the API. Modules in `src/`, schema and migrations in `prisma/`, tests next to the code as `*.spec.ts`.
- `apps/web/`: the frontend (App Router). Pages in `src/app/`, components in `src/components/` (grouped into `app/`, `board/`, `card/`, `panels/`, `ui/`, `views/`), hooks in `src/hooks/`, pure board logic in `src/lib/board/` (import from `@/lib/board`; functions return a new board and never mutate their input). Tests in `tests/unit/`, mirroring `src/`. Boards are still saved in the browser's `localStorage` (`src/hooks/useBoard.ts`, `src/lib/storage.ts`). Details in `docs/structure.md` and `docs/design-system.md`.
- `packages/contracts/`: request and response shapes (zod), imported by both apps. Rebuild with `npm run build -w packages/contracts`.
- `tests/e2e/`: Playwright tests against the running stack.
- `tools/start-stack.sh`: builds and starts everything, as CI and QA do.

## Commands
- Install: `npm ci` (also generates the Prisma client and builds the contracts)
- Lint: `npm run lint`
- Typecheck: `npm run typecheck`
- Test: `npm test`, or one package: `npm test -w apps/api`
- Build: `npm run build`
- Everything except e2e: `npm run check`
- New migration: `npm run db:migrate:dev -w apps/api -- --name <name>`
- E2E: the agents' runners have the database running. Start the stack in the background with `npm run stack`, then `npx playwright test`.

Run every command on its own, from the repository root. No `cd x && …`.

## Packages
| Path | What it is | Check it with | Depends on |
|---|---|---|---|
| `packages/contracts/` | shared shapes | `npm run typecheck -w packages/contracts` | |
| `apps/api/` | API | `npm test -w apps/api` | `packages/contracts/` |
| `apps/web/` | frontend | `npm test -w apps/web` | `packages/contracts/`, the API |

A change is done when the checks of every package it touches **and of the packages that depend on them** pass.

## Conventions
- TypeScript strict; no `any`.
- The browser only calls `/api/...` on its own origin, and Next.js forwards it to the API (`/api/cards` reaches the API's `/cards`). Never call the API's URL from the browser.
- Every endpoint's request and response shape lives in `packages/contracts`, and the API validates input with it.
- In Nest, inject with an explicit `@Inject(Service)`: Vitest emits no decorator metadata.
- Every endpoint that touches user data checks who is asking and returns only their data.
- Schema changes always come with a migration, and stay backward compatible for one deploy: the API and the web app don't deploy at the same moment. Remove things in a later PR than the one that stops using them.
- Tailwind for styling, with `dark:` variants for all new UI. Every interactive element is reachable by keyboard and has an accessible name.
- Every behaviour change has tests: unit tests in its package, and an e2e test for each user-visible flow. In e2e tests, use `page.goto("./")` and select by role or label.
- Add dependencies only when clearly justified in the PR description.
- Commits: Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`, `refactor:`).

## Risk policy
- **high** (a human merges): changes to how login, sessions or permissions work; destructive or data-rewriting migrations; deleting user data; deployment or infrastructure changes.
- **medium**: additive migrations; new endpoints that follow the existing permission checks; changes across several packages.
- **low**: changes well covered by tests that touch neither the schema nor the API.

## Testing notes for agents
- Where data lives: boards are in the browser's `localStorage` for now, and theme and other preferences stay there. Everything on the server is in Postgres, and each QA site has its own database.
- What counts as "other" data: other users' boards and cards. An action must never touch them.
- Risky areas: migrations, login and sessions, anything that deletes.
- Test accounts: `a@example.test` and `b@example.test`, password `test-password-123`, created by the seed script (`apps/api/prisma/seed.ts`) on local, CI and QA databases once accounts exist. Tests can also register new ones.
- Shared servers QA must not write to: production at https://adt-web-tau.vercel.app/. QA's baseline runs on its own machine.

## Never
- Modify `.github/`, `scripts/`, `CLAUDE.md`, secrets or deployment settings.
- Run the seed script against production, or commit `.env` files.
