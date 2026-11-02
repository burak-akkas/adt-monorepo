# Agent tooling

The scripts the agent workflows call (`.github/workflows/agent-*.yml`). They are moving from bash to
Python, one group at a time, into the `agentflow` package. A migrated script stays as a 4-line `.sh`
wrapper with the same name, arguments and output, so no workflow changes:

```sh
exec python3 -I "$(dirname "$0")/agentflow" transition "$@"
```

`-I` keeps `PYTHON*` variables and user site-packages out. The package uses only the standard
library (Python 3.10+, which every GitHub runner has) and talks to GitHub through the `gh` CLI.

## Layers

Each module uses only the ones above it:

| Module | What it holds |
|---|---|
| `model` | Plain immutable records: `Issue`, `Comment`, `LabelEvent` |
| `config` | `Settings` from the environment (`GITHUB_REPOSITORY`, `AGENT_BOT_ID`, …) and variable parsing |
| `github` | The `GitHub` interface, and `GhCli`, which implements it with `gh` (so the simulator's fake `gh` works unchanged) |
| `markers` | The `<!-- agent:… -->` handoff markers: only the bot's comments count, newest wins |
| `states` | `transition` (an item's one `agent:*` label) and `progress` (the issue's progress comment) |
| `issues` | The issue pipeline: Lead budget, split mode, splitting, advancing split issues, waiting for other issues |
| `cli` | One command per former script |

## Tests, first

A migration step always starts with tests, then the code:

1. **Unit tests** (`tests/`, against `tests/fake.py`, an in-memory GitHub): the behaviour, including
   failures. Seconds to run.
2. **Parity tests** (`scripts/sim/test_parity.py`): the bash version (from git history) and the
   Python version run on the same fake repository and must do the same. Anything changed on purpose
   is listed with the reason.
3. **The simulator** (`scripts/sim`): the scenarios, the issue-pipeline simulation and the matrix run
   the real workflow steps, which now call the Python code through the wrappers.

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

## Migration status

| Group | Scripts | State |
|---|---|---|
| Core and issue pipeline | `transition`, `progress`, `count-comments`, `url`, `branch-head`, `lead-budget`, `split-mode`, `release-blocked`, `subissues`, `split` | Python |
| Conflict avoidance | `overlap`, `release-waiting` | bash |
| Review and approvals | `approve`, `approved-sha`, `qa-passed`, `own-diff`, `same-own-changes`, `pr-still-current`, `pr-paths`, `clean-base-update` | bash |
| Merge queue | `queue`, `queue-tidy`, `sweep-conflicts`, `integrate` | bash |
| Operations | `watchdog`, `production-check`, `app-token`, `publish-pages` | bash |

Behaviour changed on purpose in the migration:

- An issue closed without a reason, or as a duplicate, counts as done for whatever waits for it.
  Bash knew only `completed` and `not_planned`, so a parent or a parked issue could wait forever.
- `progress` skips a line when it can't read the comments, instead of starting a second progress comment.
- `split` prints its `::error::` to stderr. On stdout the Architect workflow captured it into a
  variable, so it never reached the log.
