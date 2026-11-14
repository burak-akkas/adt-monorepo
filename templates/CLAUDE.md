# Project guide for agents

> Template: replace every `<...>`. Every agent reads this file on every run, so keep it short and specific.

## What this project is
<one paragraph: purpose, main users, tech stack>

## Layout
- `<src/...>`: <what lives here>
- `<tests/...>`: <test layout>

## Commands
- Install: `<npm ci | pip install -e .[dev] | ...>`
- Build: `<...>`
- Lint/format: `<...>`
- Test (all): `<...>`
- Test (single): `<...>`

> Each command above must also be allowed in the repo variable `AGENT_BUILD_TOOLS`,
> e.g. `Bash(npm ci:*),Bash(npm install:*),Bash(npm test:*),Bash(npm run lint:*)`. Without `npm install`,
> agents can't add a dependency. Include the migration and code generation commands you use, too.
> Agents run every command on its own, from the repository root: no `cd x && …`. Write commands for
> sub-directories with a directory flag (`npm --prefix web test`, `make -C backend test`,
> `go -C api test ./...`, `uv --directory backend run pytest`), or give the root one task runner.

## Packages (monorepos: delete this section otherwise)
| Path | What it is | Check it with | Depends on |
|---|---|---|---|
| `<backend/>` | <API, language> | `<make -C backend check>` | `<shared/>` |
| `<web/>` | <frontend> | `<npm --prefix web run check>` | `<shared/>`, the backend's API |
| `<shared/>` | <shared types> | `<...>` | |

- A change is done when the checks of every package it touches **and of the packages that depend on
  them** pass.
- Package-specific conventions go in a `CLAUDE.md` inside that package; agents read it when they work there.
- Services the tests need (database, queue): <how they start, e.g. `docker compose up -d db`; the repo
  variable `AGENT_SETUP_COMMAND` starts them on the agents' runners>.

## Conventions
- <language/style rules a linter does not enforce>
- <error handling, logging, naming patterns>
- Commits: Conventional Commits (`feat:`, `fix:`, `chore:` ...)
- Every behaviour change ships with a test.

## Architecture rules
- <boundaries, e.g. "UI never calls the DB directly", "no new dependencies without an ADR">

## Risk policy (optional: replaces the Architect's default list, which makes all auth, schema and API work high risk)
<!-- High-risk PRs need a human to merge. Without this section, an app with a backend needs one on almost every PR. -->
<!-- If you add this section, add CLAUDE.md to AGENT_PROTECTED_PATHS, so a PR can't relax its own risk policy. -->
- **high**: <e.g. destructive or data-rewriting migrations, changes to login, sessions or permissions, deleting user data>
- **medium**: <e.g. additive migrations, new endpoints that follow the existing permission checks>
- **low**: <e.g. changes covered by tests that touch neither the schema nor the API>

## Testing notes for agents (optional)
<!-- Helps the Reviewer and QA find side effects. Keep it short. -->
- Where data lives: <e.g. database tables, local storage keys, files, external services>
- What counts as "other" data that an action must never touch: <e.g. other users, other tenants, other projects>
- Risky areas: <e.g. migrations, billing, anything that deletes>
- Test accounts (apps with login): <seeded users and where their test passwords are, e.g. `a@example.test` and `b@example.test` from the seed script; or "register new ones">
- Shared servers QA must not write to: <e.g. production at https://…; AGENT_BASELINE_START_COMMAND gives QA its own baseline instead>

## Never
- Modify `.github/`, secrets, CI config or deployment files.
- Change public APIs or DB schemas unless the Architect's design says so explicitly.
