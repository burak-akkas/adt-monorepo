# Agent tooling

Everything the agent workflows (`.github/workflows/agent-*.yml`) run besides the agents themselves, as
one Python package, `agentflow`, with one entry point. No workflow step holds logic in bash: each is
one line, `"$BIN/agent.sh" <command> [values from the event]`, and reads its settings from the step's
`env:`.

```bash
scripts/agents/agent.sh <command> [args]
```

```bash
scripts/agents/agent.sh --help
```

`agent.sh` only runs `python3 -I scripts/agents/agentflow "$@"` (`-I` keeps `PYTHON*` variables and
user site-packages out, so only this code runs). The package uses only the standard library (Python
3.10+, which every GitHub runner has) and talks to GitHub through the `gh` CLI. Exit codes: 0 done,
1 failed (or "no", for the yes/no commands below), 2 wrong usage, 3 `pr-paths` couldn't decide.

## Commands

| Group | Commands |
|---|---|
| States and the progress log | `transition`, `progress`, `count-comments`, `url`, `branch-head` |
| The issue pipeline | `lead-budget`, `split-mode`, `split`, `subissues`, `release-blocked` |
| Conflict avoidance | `overlap`, `release-waiting` |
| Review and approvals | `approve`, `approved-sha`, `qa-passed`, `own-diff`, `same-own-changes`, `clean-base-update`, `pr-paths`, `pr-still-current` |
| The merge queue | `queue`, `queue-tidy`, `sweep-conflicts`, `integrate` |
| Operations | `watchdog`, `production-check`, `app-token`, `publish-pages` |
| Workflow steps around the agents | `analyst-apply`, `architect-split-mode`, `architect-apply`, `implementor-prepare`, `implementor-apply`, `fix-prepare`, `fix-apply`, `reviewer-guard`, `reviewer-apply`, `qa-guard`, `qa-wait-checks`, `qa-wait-preview`, `qa-apply`, `lead-guard`, `lead-apply`, `merge-risk-gate`, `merge-join`, `integrate-queue`, `report-denied` |
| QA on the runner | `qa-e2e-setup`, `qa-start-baseline`, `qa-start-app`, `qa-find-baseline`, `qa-run-e2e`, `qa-publish-screenshots`, `qa-link-screenshots` |
| Setting a repository up (run by a person) | `setup-labels <owner/repo>`, `doctor <owner/repo>` |

## Layers

Each module uses only the ones above it:

| Module | What it holds |
|---|---|
| `model` | Plain immutable records: `Issue`, `PullRequest`, `Comment`, `Commit`, `Check`, … |
| `config` | `Settings` from the environment (`GITHUB_REPOSITORY`, `AGENT_BOT_ID`, …), variable parsing, link templates |
| `clock` | Time, behind an interface: `date +%s` and `sleep`, so the simulator's virtual clock drives the code |
| `github` | The `GitHub` interface, and `GhCli`, which implements it with `gh` |
| `markers` | The `<!-- agent:… -->` handoff markers: only the bot's comments count, newest wins |
| `labels` | Every label the team uses (`setup-labels` creates them, `doctor` checks them) |
| `states` | `transition` (an item's one `agent:*` label) and `progress` (the issue's progress comment) |
| `issues` | The issue pipeline: Lead budget, split mode, splitting, advancing split issues, waiting for other issues |
| `prs` | Review and approvals: the approved commit, QA passes, a PR's own edits, clean base updates, path rules, the guard before a Reviewer/QA run |
| `queue` | The merge queue's order, tidying it, and sending PRs that conflict after a merge back |
| `overlap` | Conflict avoidance: in-flight work on the same files, and starting issues that waited for it |
| `integrator` | The Integrator's work on one queued PR: approval, update, checks, QA hold, merge |
| `watchdog`, `production`, `tokens`, `pages`, `doctor` | Operations: stalled work, the production check, App tokens, gh-pages, setup checks |
| `step` | What every workflow step shares: outputs, summary, the agent's structured result, denied tool calls |
| `roles`, `review`, `qa_run` | The workflow steps: around the issue-side agents, around the Reviewer, QA and Lead plus the merge gate, and QA's runner work |
| `cli` | The commands |

## Tests, first

Every change starts with tests, then the code:

1. **Unit tests** (`tests/`): the behaviour, including failures. `tests/support.py`'s `Repo` is the
   real `GhCli` answered by the simulator's fake `gh` (`scripts/sim/fakegh/gh`), so there is one
   fake to maintain, and the tests check the exact `gh` calls too. When the code needs a call the
   fake can't answer, extend the fake.
2. **Parity tests**: `scripts/sim/test_parity.py` runs the commands that replaced bash scripts, and
   `scripts/sim/test_step_parity.py` the workflow steps that replaced inline bash, on the same fake
   repository as the old versions (from git history: `PARITY_REF`, `STEP_REF`) and they must do the
   same. Anything changed on purpose is listed per case, with the reason.
3. **The simulator** (`scripts/sim`): the scenarios, the issue-pipeline simulation and the matrix run
   the real workflow steps, which call these commands.

```bash
python3 -m unittest discover -s scripts/agents/tests -t scripts/agents
```

```bash
python3 scripts/sim/test_parity.py
```

Lint and types, from `scripts/agents` (settings in `pyproject.toml`; CI pins the versions):

```bash
ruff check . && ruff format --check . && mypy agentflow tests
```

## Changed on purpose when the scripts moved from bash

- An issue closed without a reason, or as a duplicate, counts as done for whatever waits for it.
  Bash knew only `completed` and `not_planned`, so a parent or a parked issue could wait forever.
- `progress` skips a line when it can't read the comments, instead of starting a second progress comment.
- `split` prints its `::error::` to stderr. On stdout the Architect workflow captured it into a
  variable, so it never reached the log.
- `release-waiting` no longer ends its list of PRs with a space ("Expect conflicts with #201 ." in the comment).
- `sweep-conflicts` looks at up to 100 open PRs (bash's `gh pr list` stopped at 30).
- `integrate`: an API error while checking mergeability or how far behind the base a PR is sends it to
  the back of the queue. In bash a failed command inside `[ … ]` didn't trip the error trap, so it
  read as "not conflicting" or "not behind". The protected paths (`AGENT_PROTECTED_PATHS`) are plain
  prefixes; bash used them as regular expressions.
- `watchdog --dry-run` prints `would run: transition 7 agent:ready` instead of a script path.
- `publish-pages` copies with Python instead of `rsync`.
- A split plan the Architect got wrong is an `::error::` annotation in the Architect step's log
  (before, the split script printed it to its stderr, so it was plain text).
