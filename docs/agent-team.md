# Agentic dev team on GitHub

An autonomous team of Claude agents (**Analyst → Architect → Implementor ⇄ Reviewer → QA**, plus a **Lead** that makes the calls) that takes a GitHub issue all the way to a merged PR. Nobody has to prompt them: they talk to each other through issues, PRs, comments and labels. A human is only pulled in when the Lead escalates.

It runs on **GitHub Actions** (works on GitHub Free) with [`anthropics/claude-code-action`](https://github.com/anthropics/claude-code-action), authenticated with your **Claude subscription** (`claude setup-token`).

## How it works

```
 new issue ──► 🔍 Analyst ──► 🏛 Architect ──► 🛠 Implementor ──► 🧐 Reviewer ──► 🚦 Merge queue ──► 🧪 QA ──► ✅ merged
                  │               │  risk:low/med       opens PR      ▲     │ approve      │ up to date,   │ pass,    │
                  │               │                   + 🔎 preview    │     │              │ checks green  │ once     ▼
                  │               │                           fix ────┘◄────┴──────────────┴───────────────┘    🌐 production
                  │               │                       (Implementor)   changes · conflicts · red checks · defects
                  ▼               ▼
         open questions    high risk / unsure      stuck · failed · review/QA deadlock · merge conflict
                  └───────────────┴──────────────────────┬───────────────────┘
                                                         ▼
                                           🧭 Lead (agent:needs-decision)
                                 answers · approves · redesigns · retries · closes
                                                         │  only if truly needed, or 3 decisions failed
                                                         ▼
                                           👤 human (agent:needs-human, assigned)
```

- **Labels are the state machine.** Each workflow fires on a specific label (or PR event). The agent decides the outcome and returns it as structured JSON. A plain shell step then applies the next label using `agent.sh transition`. Agents never change labels themselves.
- **Handoffs are structured comments** with a hidden marker (`<!-- agent:analyst -->` and so on). Workflows check that the comment was actually posted; if it wasn't, the item goes to the Lead.
- **The Lead is the decision maker.** Every "stuck" state goes to `agent:needs-decision` instead of a human. The Lead answers the Analyst's questions, rules on high-risk designs and review deadlocks, retries failed stages, or closes the item. Its decision overrides earlier comments. It only escalates for irreversible or high-impact choices, or after `AGENT_MAX_LEAD_DECISIONS` (default 3) on the same item.
- **Big issues are split.** When an issue is too big for one reviewable PR, the Architect returns a split plan instead of a design. `agent.sh split` creates the sub-issues (linked as GitHub sub-issues, each with its own acceptance criteria) and the parent waits in `agent:split`. Sub-issues without dependencies start at once and run in parallel; the others wait in `agent:blocked` until what they depend on is merged. When the last one closes, the parent closes. A sub-issue can be split again, down to `AGENT_MAX_SPLIT_DEPTH` levels (default 2). A `ready` design that plans more than `AGENT_MAX_PLANNED_FILES` files (default 20) is sent back to be split, and an Implementor run that pushed work without finishing continues on its own, up to `AGENT_MAX_CONTINUATIONS` runs per design (default 3).
- **Review loops end early.** The Reviewer numbers blocking items `B1`, `B2`, … across rounds and reuses an ID when the same problem comes back. The workflow records each round's commit and IDs on the Reviewer's comment, so the next round gets the IDs so far, a diff of the PR's own edits since the previous review (new blocking items are only allowed there, or for regressions), and the files the design didn't plan. An ID that comes back after a fix round goes to the Lead at once, instead of after `AGENT_MAX_REVIEW_ROUNDS`.
- **Every PR gets a live preview** at `…/pr-<N>/` (link posted on the PR). **The QA agent** tests a PR **once, at the front of the merge queue**: after the Reviewer approved it, the Integrator brought it up to date with the default branch and the required checks passed on that commit. Nothing else merges while QA tests, so QA tests exactly the code that lands, and conflicts with other PRs never cost a QA round (`AGENT_QA_STAGE=review` restores the older flow: QA right after the review, before the queue). QA waits until the preview serves the PR's exact commit, runs the project's Playwright e2e suite against it, then tests the acceptance criteria in a real headless Chrome (Playwright MCP). It also **compares the changed screens with the baseline** (production, i.e. the base branch without the PR) at desktop and phone width: any visual change the issue didn't ask for, such as clipped or overlapping controls, is a defect. It posts a report with **screenshots in the PR**, including the before/after pairs. Defects go back to the Implementor, with steps to reproduce.
- **Conflicts are avoided before they happen.** The Architect lists the files its design will change. If work in flight (an open agent PR, or an issue the Implementor is starting) changes the same files, the issue waits in `agent:waiting` until that work merges, then starts from code that already contains it, instead of conflicting later and paying for a conflict fix, a re-review and another trip through the queue. Waiting issues start oldest first, one at a time, after every merge and on every watchdog check, and never wait longer than `AGENT_CONFLICT_WAIT_MINUTES` (default 120). Work waiting for a human, and drafts, don't block anyone ([`overlap.py`](../scripts/agents/agentflow/overlap.py)).
- **The merge queue replaces the human merge.** The merge gate checks the approval and the risk, then puts the PR in the queue (`agent:queued`). High-risk changes (`risk:high`, set by the Architect) still go to a human unless you allow them explicitly. The **Integrator** merges queued PRs **one at a time**, oldest first: right before merging, it brings the PR up to date with the default branch, waits for the required checks on exactly that commit, and squash-merges exactly that commit. So CI always tests what lands, and every PR is updated and tested once, however many PRs run in parallel. Its own updates don't change the PR's changes, so they skip review. When the Lead or a human approves a commit again after its required checks failed (a flaky test, say), the Integrator re-runs the failed jobs once, with its job's own `GITHUB_TOKEN` (`actions: write`), instead of reading the old result. QA runs at the front of the queue, unless it already passed the same own changes (or the Lead or a human approved them).
- **One custom GitHub App** is the agents' identity. Events created by an App token *do* trigger other workflows. Events created by the default `GITHUB_TOKEN` don't, and that would break the chain.

| File | Purpose |
|---|---|
| [.github/agents/*.md](../.github/agents/) | Role prompts (analyst, architect, implementor, reviewer, qa, lead). Review and version them like code |
| [.github/workflows/agent-*.yml](../.github/workflows/) | One workflow per role, plus `agent-merge.yml` (merge gate: admits approved PRs to the queue), `agent-integrator.yml` (merge queue), `agent-production-check.yml` (after a merge, optional), `agent-watchdog.yml` and `agent-chat.yml` (human `@claude`) |
| [.github/workflows/pages-janitor.yml](../.github/workflows/pages-janitor.yml) | Weekly: removes QA screenshots `AGENT_QA_SCREENSHOT_DAYS` after their PR closed, and leftover previews, from `gh-pages`, then squashes its history. Does nothing without a `gh-pages` branch |
| [scripts/agents/](../scripts/agents/) | Everything the workflows run besides the agents: one Python package, `agentflow`, behind one entry point, `scripts/agents/agent.sh <command>` (state transitions, handoff checks and loop budgets, the progress log, the merge queue, conflict avoidance, splitting, approvals and own-diffs, QA's runner work, the watchdog). Standard library only, with unit tests. PR-triggered workflows run it from the default branch. Its [README](../scripts/agents/README.md) lists the commands and modules |
| [scripts/install.sh](../scripts/install.sh) | Copies the toolkit into another repository's working copy (without the project's own CI, deploy and preview workflows, and without the tooling's tests), and never overwrites changed files without `--force` |
| `agent.sh setup-labels <owner/repo>` | Creates the labels |
| `agent.sh doctor <owner/repo>` | Checks a repository's wiring before the first issue: toolkit files, App variables and secrets, labels, required checks, and the QA, merge and link settings. Changes nothing |
| [scripts/sim/](../scripts/sim/) | **Simulator** for the agent tooling: runs the real commands and workflow steps against a simulated GitHub and scripted agents, through deterministic scenarios and a randomized matrix of real-world trouble (conflicts, flaky CI, lost webhooks, API errors, killed jobs, humans interfering). Proves nothing gets stuck and the merge queue never merges untested or unapproved code. Parity tests check the Python commands against the bash scripts they replaced. [`agent-sim.yml`](../.github/workflows/agent-sim.yml) runs it on PRs that change the tooling. See its [README](../scripts/sim/README.md) |
| [.github/ISSUE_TEMPLATE/agent-task.yml](../.github/ISSUE_TEMPLATE/agent-task.yml) | Issue form that starts the pipeline |
| [templates/CLAUDE.md](../templates/CLAUDE.md) | Project guide every agent reads. Copy it to the target repo root as `CLAUDE.md` and fill it in |

## Setup (about 15 minutes)

1. **Copy the toolkit** into the target repo: `scripts/install.sh <path-to-target-checkout>` (re-run with `--force` to update it later). It also creates `CLAUDE.md` from the template: fill it in. The project needs a CI workflow with real tests: in autonomous mode, **tests are the safety net**. Not a Node project, or no preview deploys? See **Other stacks** below.
2. **Create a GitHub App** (Settings → Developer settings → GitHub Apps → New). It's free on any plan.
   - Name, e.g. `acme-agents`. Disable the webhook.
   - Repository permissions: **Contents: R/W, Issues: R/W, Pull requests: R/W, Checks: Read, Commit statuses: Read, Actions: Read**, Metadata: Read. With `AGENT_PREVIEW_URL=deployment`, also **Deployments: Read**.
   - Deliberately **do not** grant *Workflows* permission. That way agents can't change CI.
   - Create it, note the **App ID**, generate a **private key**, and install the app on the repo.
3. **Get a Claude token:** run `claude setup-token` locally (needs Pro, Max, Team or Enterprise).
4. **Add secrets and variables** (repo → Settings → Secrets and variables → Actions):

   | Kind | Name | Value |
   |---|---|---|
   | Secret | `CLAUDE_CODE_OAUTH_TOKEN` | output of `claude setup-token` |
   | Secret | `AGENT_APP_PRIVATE_KEY` | contents of the `.pem` file |
   | Variable | `AGENT_APP_ID` | App ID |
   | Variable | `AGENT_BOT_ID` | The bot's user id: `gh api '/users/<app-slug>%5Bbot%5D' --jq .id`. Workflows recognise the agents' comments by this id, which (unlike the login) survives renaming the App. The login itself is read from the App token at run time |
   | Variable | `AGENT_BUILD_TOOLS` | commands the Implementor may run, e.g. `Bash(npm ci:*),Bash(npm install:*),Bash(npm test:*),Bash(npm run lint:*)`. Without `npm install`, it can't add a dependency |
   | Variable | `AGENT_ESCALATION_ASSIGNEE` | GitHub username assigned when the Lead escalates |

5. **Choose an autonomy level** (variables, below).
6. **Create the labels:** `scripts/agents/agent.sh setup-labels owner/repo` (needs the `gh` CLI and Python 3.10+).
7. **Check the wiring:** `scripts/agents/agent.sh doctor owner/repo`. It lists what's missing or doesn't fit together (e.g. a required check that matches no workflow, a merge method the repository doesn't allow, QA without a preview or a start command).
8. **Try it:** open an issue with the *Agent task* form, or add `agent:start` to any issue. Watch the Actions tab.

### Other stacks

The defaults fit a Node project with GitHub Pages previews (like this pilot). Everything stack-specific is a variable:

| Variable | Default | Use |
|---|---|---|
| `AGENT_NODE_VERSION` | `22` | `none` skips installing Node (QA's browser tools then use the runner's preinstalled Node) |
| `AGENT_SETUP_COMMAND` | | Runs before the Implementor and before QA's e2e setup, e.g. `pip install -r requirements.txt` or installing Go tools. Allow the Implementor's build commands with `AGENT_BUILD_TOOLS` |
| `AGENT_E2E_SETUP` | `npm ci` | QA's setup for the e2e suite (`none`: nothing) |
| `AGENT_E2E_COMMAND` | `npx playwright test` | QA's e2e suite, run with `E2E_BASE_URL` set to the site under test. `none`: no suite, QA only tests in the browser |
| `AGENT_PREVIEW_URL` | `https://{owner}.github.io/{repo}/pr-{pr}/` | Where each PR's preview lives (also linked from the issue); it serves `version.txt` with the commit it was built from. `deployment`: the preview is the URL of the PR head's successful **GitHub deployment**, which Vercel, Netlify, Render and most hosts report (give the App *Deployments: Read*). `none`: no preview deploys; QA starts the app on its runner instead |
| `AGENT_PREVIEW_ENVIRONMENT` | | With `AGENT_PREVIEW_URL=deployment`: only deployments to this environment (e.g. `Preview`) |
| `AGENT_QA_START_COMMAND` | | With `AGENT_PREVIEW_URL=none`: starts the app in the background, e.g. `npm run build && npx serve out -l 3000` |
| `AGENT_QA_LOCAL_URL` | `http://localhost:3000/` | With `AGENT_PREVIEW_URL=none`: where the started app answers |
| `AGENT_PRODUCTION_URL` | `https://{owner}.github.io/{repo}/` | The deployed default branch, linked when a PR merges. `none`: no link |
| `AGENT_BASELINE_START_COMMAND` | | Starts QA's visual baseline on the runner, from a checkout of the base branch outside the workspace, instead of using `AGENT_BASELINE_URL`. It needs its own port and database |
| `AGENT_BASELINE_LOCAL_URL` | `http://localhost:3001/` | With `AGENT_BASELINE_START_COMMAND`: where the baseline answers |
| `AGENT_PRODUCTION_CHECK_URL` | | After each merge, [`agent-production-check.yml`](../.github/workflows/agent-production-check.yml) waits for this URL's body to contain the merged commit's sha (a health endpoint, or `version.txt`). If it doesn't, it opens one issue for a human, which closes itself on recovery. Unset: no check |
| `AGENT_PRODUCTION_CHECK_MINUTES` | `15` | How long the production check waits for the deploy |
| `AGENT_MERGE_METHOD` | `squash` | How the merge queue merges: `squash`, `merge` or `rebase` (the repository must allow it) |
| `AGENT_QA_SCREENSHOTS` | `pages` (public repos), `artifact` (private) | `pages`: QA screenshots go to the `gh-pages` branch and show inline in the PR. `artifact`: they stay in the run's artifacts, in their own `…-screenshots` download, and the PR links to them; for private repositories, where raw `gh-pages` image links don't render, and repos without `gh-pages` |

### Monorepos (e.g. a backend and a frontend)

- **Commands:** list each package in the "Packages" table of [`CLAUDE.md`](../templates/CLAUDE.md) with the command that checks it and what depends on it. The Implementor runs the checks of every package it changes and of their dependents. Agents run commands from the root, one at a time (no `cd x && …`), so write them with directory flags (`npm --prefix web test`, `make -C backend test`, `go -C api test ./...`) or give the root a task runner. Allow them in `AGENT_BUILD_TOOLS`. A `CLAUDE.md` inside a package holds its own conventions.
- **Path-filtered CI:** if CI workflows only run for some paths, scope them in `AGENT_REQUIRED_CHECKS` the same way: `Backend CI@backend/|shared/, Frontend CI@web/|shared/, Lint`. A scoped check is only waited for when the PR changes a file under one of its prefixes, so a backend-only PR doesn't wait forever for a frontend workflow that never starts. Unscoped names (`Lint`) apply to every PR, and you need at least one: a PR that only changes a root file, such as the lockfile, would otherwise merge with no checks. (`agent.sh pr-paths`)
- **QA only where it helps:** `AGENT_QA_PATHS=web/|packages/ui/` sends only PRs that change those paths through browser QA; a backend-only PR merges after review and CI. Leave it unset when backend changes show up in the UI. QA checks a criterion with no UI by calling the API from the page, or reports it as covered by the e2e results.
- **Services and toolchains:** `AGENT_SETUP_COMMAND` prepares the runner for the Implementor and QA, e.g. `docker compose up -d db && pip install -r backend/requirements.txt` (Docker, Python, Go and Java are preinstalled on GitHub's Ubuntu runners). A full-stack preview is either a deploy that reports to GitHub (`AGENT_PREVIEW_URL=deployment`) or the whole stack started on QA's runner (`AGENT_PREVIEW_URL=none`, `AGENT_QA_START_COMMAND="docker compose up -d"`, `AGENT_QA_LOCAL_URL` the frontend's URL).
- **Risky areas** (migrations, infrastructure): add them to `AGENT_PROTECTED_PATHS` so a human merges PRs that touch them, and list them under "Risky areas" in `CLAUDE.md` for the Architect's risk call.

### Apps with a server and login

QA used to be free to write anything on any site, because a static app keeps its data in the browser. With a real backend, a few things need setting up:

- **Test on the runner.** `AGENT_PREVIEW_URL=none` with `AGENT_QA_START_COMMAND` starts the whole stack from the PR's exact commit, with a fresh database, so PRs can't see each other's data or migrations. Hosted previews (`deployment`) also work, but check first: a login wall on previews (Vercel's Deployment Protection, say) stops QA, each PR needs its own database, each web preview must find the API preview of the same PR, and a PR that skips the web build leaves QA without a deployment to test.
- **Never let QA write to production.** Set `AGENT_BASELINE_URL=none`, or `AGENT_BASELINE_START_COMMAND` to start the base branch next to the PR, with its own port and database. If the baseline is a shared site, QA only compares what it can see without writing. With login, a baseline on the runner has a catch: browsers don't separate cookies by port, so `localhost:3000` and `localhost:3001` overwrite each other's sessions. Give it another host (`127.0.0.1`, also in `AGENT_BASELINE_LOCAL_URL` and your auth settings), or turn it off.
- **Keep setup in the setup variables:** `AGENT_SETUP_COMMAND` installs, starts the database and prepares it, for example `npm ci && docker compose up -d --wait db && npm run db:migrate:deploy -w apps/api && npm run db:seed -w apps/api`. The Implementor runs the backend's tests on that database, so without the migrations every test that touches a table fails. `AGENT_QA_START_COMMAND` then starts the servers, with their own migrations and seed data. Agent jobs get no production secrets: keep those in a GitHub environment that only your deploy workflow uses.
- **Tell the agents about accounts and data:** fill in "Test accounts" and "Shared servers" in `CLAUDE.md`. QA then tests with two users, including that one can't reach the other's data.
- **Write a risk policy.** By default, the Architect treats auth, schema and public API changes as high risk, and a human merges those, which on a backend is nearly every PR. A "Risk policy" section in `CLAUDE.md` replaces that list. Add `CLAUDE.md` to `AGENT_PROTECTED_PATHS` (with the defaults), so a PR can't relax its own policy.
- **Watch production:** set `AGENT_PRODUCTION_CHECK_URL`, since a merge can pass everything and still fail to deploy. Keep API changes backward compatible for one deploy when the frontend and the backend don't deploy together.

## Autonomy levels

| Variable | Supervised | **Autonomous** | Notes |
|---|---|---|---|
| `AGENT_AUTO_START` | – | `true` | New issues from collaborators enter the pipeline without a label |
| `AGENT_AUTONOMY` | – | `full` | The Lead answers the Analyst's questions instead of a human |
| `AGENT_REQUIRE_DESIGN_APPROVAL` | `true` | – | When `true`, every design waits for a human `agent:ready` |
| `AGENT_QA` | – | `true` | The QA agent tests every PR in the browser before it merges (needs a preview deploy) |
| `AGENT_QA_STAGE` | | | When QA runs. Unset or `queue`: once, at the front of the merge queue, on the up-to-date commit whose checks passed, while the queue waits. `review`: right after the Reviewer approves, before the queue (the older flow: conflicts and fixes after QA send the PR through QA again) |
| `AGENT_QA_ON_BASE_UPDATE` | – | – | Only with `AGENT_QA_STAGE=review`. `true`: QA tests an approved PR again after the Integrator merged the latest default branch into it, and the merge queue waits for it. Otherwise only CI re-runs |
| `AGENT_SKIP_REVIEW_ON_SAME_CHANGES` | – | `true` | `true`: when an approved PR is pushed again but its own added and removed lines are exactly as approved (typically a conflict resolution that kept both sides), skip the re-review, as for a clean update; CI tests the combination. Otherwise the Reviewer re-reviews, focused on how the PR's own edits changed |
| `AGENT_AUTO_MERGE` | – | `true` | **Kill switch** for the merge gate and the merge queue |
| `AGENT_PAUSED` | | | `true` pauses every agent job (see Human controls) |
| `AGENT_AUTO_MERGE_HIGH_RISK` | – | – | `true` lets the agents merge `risk:high` changes too (not recommended) |
| `AGENT_REQUIRED_CHECKS` | | `CI` | Comma-separated workflow names that must pass before merge. `Name@prefix\|prefix` scopes one to PRs that change those paths (see Monorepos) |
| `AGENT_AVOID_CONFLICTS` | | | `false` turns conflict avoidance off (issues start right after the design, even when in-flight work changes the same files) |
| `AGENT_CONFLICT_WAIT_MINUTES` | `120` | `120` | Conflict avoidance: the longest an issue waits for overlapping work before it starts anyway |
| `AGENT_CONFLICT_IGNORE` | | | Conflict avoidance: files that don't count, `\|`-separated globs. Default: lockfiles and changelogs (`*package-lock.json\|*yarn.lock\|…\|*CHANGELOG.md`) |
| `AGENT_QA_PATHS` | | | Only PRs that change files under these prefixes (`web/\|packages/ui/`) go through QA. Unset: every PR |
| `AGENT_SPLIT` | | | `false` stops the Architect from splitting big issues into sub-issues |
| `AGENT_MAX_SUBISSUES` | `5` | `5` | Maximum sub-issues per split |
| `AGENT_MAX_SPLIT_DEPTH` | `2` | `2` | How many levels deep issues may be split (a sub-issue of a sub-issue is level 2) |
| `AGENT_MAX_PLANNED_FILES` | `20` | `20` | A `ready` design that plans more files than this (tests included) is sent back to be split |
| `AGENT_MAX_CONTINUATIONS` | `3` | `3` | Implementor runs that may continue unfinished pushed work per design before the Lead decides |
| `AGENT_MAX_REVIEW_ROUNDS` | `3` | `3` | Rejected review rounds before the Lead steps in. A blocking ID that comes back hands the PR to the Lead earlier |
| `AGENT_QA_SCREENSHOT_DAYS` | `7` | `7` | Days QA screenshots stay after a PR closes ([pages-janitor.yml](../.github/workflows/pages-janitor.yml) also squashes `gh-pages` weekly) |
| `AGENT_MAX_QA_ROUNDS` | `3` | `3` | Failed QA rounds before the Lead steps in |
| `AGENT_WATCHDOG_MINUTES` | `10` | `10` | The [watchdog](../.github/workflows/agent-watchdog.yml) re-triggers items whose state hasn't moved this long while no agent run is queued or running for them. It runs this long after the last agent run finishes, plus every 10 minutes as a backup |
| `AGENT_WATCHDOG_RETRIES` | `2` | `2` | Watchdog retries per item (since the last Lead decision) before it goes to the Lead |
| `AGENT_IMPLEMENTOR_MAX_TURNS` | `150` | `150` | Turn budget of an Implementor run |
| `AGENT_MAX_LEAD_DECISIONS` | `3` | `3` | Lead decisions per item before a human is assigned |
| `AGENT_INTEGRATOR_MAX_ATTEMPTS` | `3` | `3` | Failed merge attempts per PR (red checks on the combined code, checks that don't finish, failed merges) since the last Lead decision before the Lead steps in. Conflicts don't count |
| `AGENT_INTEGRATOR_CHECKS_MINUTES` | `30` | `30` | How long the Integrator waits for the required checks before sending the PR to the back of the queue |
| `AGENT_INTEGRATOR_QA_MINUTES` | `60` | `60` | How long the queue waits for QA at its front. After that the queue moves on, and the PR rejoins it when QA passes |
| `AGENT_INTEGRATOR_DRAIN_MINUTES` | `100` | `100` | After this long, an Integrator run hands the rest of the queue to a fresh run (jobs can't run forever) |
| `AGENT_PREVIEW_URL` | | | Preview URL template for QA, default `https://{owner}.github.io/{repo}/pr-{pr}/`. The preview must serve `version.txt` containing the PR head SHA. `none`: no previews (see Other stacks) |
| `AGENT_BASELINE_URL` | | | The "before" site for QA's visual comparison: the base branch without the PR, default `https://{owner}.github.io/{repo}/` (production). It should serve `version.txt`, so QA knows when it lags the base branch. `none` turns the comparison off. For an app with server-side data, see `AGENT_BASELINE_START_COMMAND` |
| `AGENT_MODEL` / `AGENT_REVIEWER_MODEL` / `AGENT_QA_MODEL` / `AGENT_LEAD_MODEL` | | | e.g. a cheaper model for the workers and a stronger one for Reviewer and Lead |

"–" means unset. Unset variables mean the more conservative behaviour.

## Human controls

You don't need to do anything in autonomous mode. These are overrides:

| You want to… | Do this |
|---|---|
| Start the pipeline on an issue | Add `agent:start` (automatic with `AGENT_AUTO_START`) |
| Handle an escalation | You're assigned; decide, then apply the next state label (e.g. `agent:ready`, `agent:review`) or close it |
| Ask the Lead to step in | Add `agent:needs-decision` |
| Start an issue that waits for overlapping work | Apply `agent:ready` (it starts now and may conflict later) |
| See what the agents are doing | The issue's "📋 Agent progress" comment, and the labels: `agent:waiting` means the issue waits for work on the same files to merge first, `agent:fixing` means the Implementor is working on the PR right now (conflict, review or QA feedback), `agent:qa` that QA is testing it |
| See the merge queue | Filter PRs by `agent:integrating` (being merged now) and `agent:queued`. Each queued PR has a "Queued for merge" comment, and the Integrator's job summary lists the queue |
| Merge a PR through the queue | Add `agent:approved` (you approve its current head). It joins the back of the queue |
| Take a PR out of the queue | Mark it as draft (agents ignore drafts; mark it ready to send it through review and back into the queue). Removing `agent:queued` only takes it out for a moment: the watchdog sends unlabeled agent PRs back to review. Pushing to it also takes it out (it goes through review again) |
| Restart the merge queue | `gh workflow run agent-integrator.yml` (the watchdog also does this when PRs wait without an Integrator run) |
| Get a review of your own PR | Add `agent:review` |
| Ask for something ad hoc | Comment `@claude …` |
| Stop merging | Set `AGENT_AUTO_MERGE` to anything but `true`. A running Integrator finishes its current pass of the queue, so cancel its run too to stop at once. Queued PRs keep their place |
| Pause all agents | Set the repo variable `AGENT_PAUSED` to `true`: every agent job (including the merge gate and watchdog) skips. Events during the pause are not queued, so to resume, delete the variable and run the watchdog once (`gh workflow run agent-watchdog.yml`); it re-triggers everything that changed state meanwhile |
| Stop everything for good | Disable the workflows (Actions tab), or remove the `agent:*` labels |

## Safety rails built in

- Only the **owner, org members and collaborators** can trigger agents. Outsiders' issues and comments are filtered out before any job starts, agents ignore their comments, and handoff markers only count when the agents' bot posted them. Bots other than the team's App are rejected. The App is identified by its user id (`AGENT_BOT_ID`), so renaming it breaks nothing.
- On a public repo, consider limiting interactions to collaborators (up to 6 months, renewable): `gh api -X PUT repos/<owner>/<repo>/interaction-limits -f limit=collaborators_only -f expiry=six_months`.
- Each role gets a **least-privilege tool allowlist**. Analyst, Architect, Reviewer and Lead can't edit code or run git. The Implementor can edit, move (`git mv`), delete (`git rm`) and commit files and create folders, but can't force-push or push to the default branch. Denied tool calls are listed in the job summary.
- The App has no *Workflows* permission, so agents can't push changes to `.github/workflows/`. That permission doesn't cover the role prompts (`.github/agents/`) or the scripts (`scripts/`), so the merge gate never auto-merges a PR that touches `AGENT_PROTECTED_PATHS` (default `.github/,scripts/,templates/`): a human merges it.
- For PR-triggered runs, role prompts are loaded from the **default branch** (`.agent-trusted/`), so a PR can't rewrite its own reviewer instructions.
- Issue and PR text is treated as data, never as instructions (stated in every role prompt).
- QA's checkouts leave no token in `.git/config`, so the PR's install scripts and e2e suite run without one. This isn't full isolation: while the QA agent runs, `claude-code-action` puts its own token in the origin URL, and an app started on the runner runs as the same user. If that matters, run the app in containers that don't mount the workspace.
- The merge queue only merges the **exact commit that was approved**: every agent approval records its commit (`agent.sh approve`), and anything pushed after it, by anyone, goes back to review. The only exception is the Integrator's own merge of the default branch into an approved commit (`agent.sh clean-base-update` checks that it is GitHub's clean merge commit, not a hand-made one), which it records as approved. It merges with `--match-head-commit`, only after the required checks passed on that commit, and never `risk:high` by default: it checks the issue's risk and the protected paths again right before merging, in case they changed after the approval.
- **Verdicts never land on a changed PR.** Reviewer and QA re-check the PR just before applying their verdict; if it got new commits, a conflict flag or a Lead decision meanwhile, the verdict is dropped and the newer state stays.
- **Parallel PRs stay correct and cheap: the merge queue.** Without branch protection nothing forces a PR to include the latest default branch, and when each approved PR merged on its own, every merge made all other approved PRs update and test again (with N parallel PRs, O(N²) CI runs, plus re-reviews and QA rounds that used up their budgets), while two PRs whose checks finished together could both merge without ever being tested together. Now the Integrator ([`agent-integrator.yml`](../.github/workflows/agent-integrator.yml), [`integrator.py`](../scripts/agents/agentflow/integrator.py)) is the only thing that merges, one PR at a time (one concurrency group for the repository; each run drains the whole queue, so GitHub dropping pending runs doesn't matter). It updates a PR right before merging it, tests exactly that commit, and checks that the default branch hasn't moved before it merges (else it updates again). Queued PRs aren't touched while they wait, so each is updated and tested once. Conflicts and checks that fail only on the combined code go back to the Implementor, with the merge queue's comment saying why. After a merge, other agent PRs that now conflict are sent to the Implementor at once (`agent.sh sweep-conflicts`), so they're resolved while the queue moves on. After a conflict resolution, the Reviewer only reviews how the PR's own edits changed (`agent.sh same-own-changes`), or skips the review when they didn't (`AGENT_SKIP_REVIEW_ON_SAME_CHANGES`). PR-driven agent workflows use `pull_request_target`, because GitHub runs no `pull_request` workflows for conflicting PRs. They only act on same-repo PRs. Queued Reviewer and QA runs first re-check the live PR (`agent.sh pr-still-current`) and skip when it has newer commits, a pending verdict, a conflict, or is in the merge queue, so no round is spent on stale code.
- **Dropped runs are re-queued.** Sub-issue runs (and the watchdog) sweep every open split issue, so a dropped sub-issue event is caught up by the next run.
- **Dropped review/QA handoffs are re-queued.** GitHub keeps only one pending run per concurrency group and silently cancels the older one. When a Reviewer or QA run skips because the PR waits in another agent's state, it re-applies that state, so a dropped handler gets queued again.
- **Nothing stalls silently:** a cancelled or crashed run leaves its state label behind with nothing working on it. The watchdog runs 10 minutes after agent runs finish, at most one check at a time, so a stall is caught within about 20 minutes even while other issues keep the agents busy (plus every 10 minutes as a backup, though GitHub's scheduler often skips those runs), finds such items, re-triggers them (twice by default), then hands them to the Lead, or to a human if the Lead is what stalls.
- **Budgets everywhere:** rejected review rounds and failed QA rounds (re-runs after base updates don't count), failed merge attempts in the merge queue (conflicts don't count), Lead decisions, `--max-turns` per role, `timeout-minutes` per job, one run at a time per issue or PR (`concurrency`).
- Every decision is a comment, so the issue and PR history is a complete audit trail.

## Costs and limits

- **Claude:** runs use your subscription. Headless and Agent SDK usage may draw from a separate monthly credit on Pro and Max plans, so check Anthropic's current Help Center article. One issue typically costs 4–8 agent runs (roughly $0.05–0.50 of usage each with Sonnet on a small repo; see `total_cost_usd` in the run logs). If you hit limits, lower `--max-turns` or set a cheaper `AGENT_MODEL`. For team-wide rollout, use a Team/Enterprise plan or a Console API key (`anthropic_api_key`), because an OAuth token is tied to one person's subscription.
- **GitHub Free:** Actions are free on public repos. Private repos get 2,000 minutes a month, and two things here add up: the watchdog's wait after each burst of agent activity occupies a runner (the length of the burst plus 10 minutes), and its 10-minute backup schedule bills about 144 minutes a day, because every job is rounded up to a full minute. On a private repo, make the backup hourly (`cron: "7 * * * *"`) or remove it. Also, the Integrator occupies one runner while the merge queue isn't empty: it polls CI for each PR in turn (up to 30 minutes each). Branch protection on private repos needs a paid plan; the merge gate enforces checks itself.

## Ideas for later

- A scheduled "maintainer" agent that triages stale issues and CI failures.
- Make the queue a hard rule: a branch ruleset that requires the `CI` check and up-to-date branches stops humans from merging untested combinations too (the Integrator already merges that way). In an organization-owned repo, GitHub's native merge queue could replace the Integrator.
- Batch the merge queue (test the first few queued PRs together, bisect on failure) if it often holds more than a handful of PRs.
- Move the workflows into a reusable workflow in an org-level repo once the pilot works.
- Learn from finished work: turn each PR's blocking items and QA defects into proposed lessons, keep the ones a human picks in a `docs/pitfalls.md` that the Architect, Implementor and Reviewer read, and check new work against them.
- A **Reach** section from the Analyst (every screen, flow and endpoint a shared change touches) for the Reviewer's tests and QA's regression checks, and `must` versus `check` acceptance criteria.
- A read-only Explorer subagent that answers one question about the codebase ("does a helper for X exist?") for the Architect and Reviewer, to save turns in the expensive roles.
- Read-through reviews of the role files: a smaller model reads each one as that agent and answers scenario questions taken from real failures, and the answers are compared with what was intended. When a run goes wrong, fix the rule that let it happen, not the run.

