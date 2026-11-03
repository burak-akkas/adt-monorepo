"""The watchdog: finds agent work that stalled (an item sits in a state where an agent should be
working, longer than any run takes, with no agent run active for it: a cancelled, timed out or crashed
run) and re-triggers it; after `retries` retries since the last Lead decision it hands the item to the
Lead (or to a human, if the Lead is what stalls). It also starts issues waiting for overlapping work
and restarts the merge queue when PRs wait in it but no Integrator run is active."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timezone

from agentflow import markers, overlap, queue
from agentflow.clock import Clock, SystemClock
from agentflow.config import Settings
from agentflow.github import GitHub
from agentflow.model import Issue
from agentflow.states import progress, transition

PR_STATES = ("agent:review", "agent:qa", "agent:approved", "agent:changes-requested", "agent:fixing", "agent:needs-decision")
ISSUE_STATES = ("agent:start", "agent:analyzed", "agent:ready", "agent:in-progress", "agent:needs-decision")
ACTIVE = ("queued", "in_progress", "waiting", "pending")
INTEGRATOR_ACTIVE = ("queued", "in_progress", "waiting", "pending", "requested")


@dataclass(frozen=True)
class WatchConfig:
    minutes: int = 10  # AGENT_WATCHDOG_MINUTES: a state older than this, with no run active, is stalled
    retries: int = 2  # AGENT_WATCHDOG_RETRIES since the last Lead decision, then the Lead (or a human)
    auto_merge: bool = False  # AGENT_AUTO_MERGE: look after the merge queue
    avoid_conflicts: bool = True
    conflict_wait_minutes: int = 120
    conflict_ignore: str = overlap.DEFAULT_IGNORE
    dry_run: bool = False


def _epoch(iso: str) -> float:
    return datetime.strptime(iso, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc).timestamp()


def _state(gh: GitHub, item: Issue) -> tuple[str, str] | None:
    """(state, since when) for an item an agent should be working on, None for any other item."""
    states = PR_STATES if item.is_pr else ISSUE_STATES
    state = next((label for label in item.labels if label in states), None)
    if state is None:
        # An agent PR without any agent:* label waits for the Reviewer (it runs on every push).
        if not item.is_pr or any("agent:" in label for label in item.labels) or not gh.pr(item.number).is_agent_branch:
            return None
        return "none", item.updated_at
    applied = [e.created_at for e in gh.label_events(item.number) if e.label == state]
    return (state, applied[-1]) if applied else None


@dataclass
class _Watch:
    gh: GitHub
    s: Settings
    cfg: WatchConfig
    clock: Clock
    out: list[str]

    def act(self, what: str, fn: Callable[..., object], *args: object, **kwargs: object) -> None:
        """Does it, or with dry_run only says what it would do."""
        if self.cfg.dry_run:
            self.out.append(f"  would run: {what}")
            return
        said = fn(*args, **kwargs)
        if isinstance(said, str):  # e.g. a transition's "#7 -> agent:ready", for the run log
            self.out.append(said)

    def examine(self, item: Issue, now: float, active: set[str]) -> tuple[str, int] | None:
        """(state, age in minutes) if the item is stalled: older than the threshold, no run active."""
        if item.is_pr and item.is_draft:
            return None  # drafts are paused on purpose
        state = _state(self.gh, item)
        if state is None or not state[1]:
            return None
        age = int((now - _epoch(state[1])) // 60)
        if age < self.cfg.minutes:
            return None
        if item.title in active:
            self.out.append(f"#{item.number} {state[0]} for {age}m, but an agent run is active: waiting")
            return None
        return state[0], age

    def retries_so_far(self, n: int) -> int:
        mine = markers.from_bot(self.gh.comments(n), self.s.bot)
        return sum(1 for c in mine[markers.last_index(mine, markers.tag("lead")) + 1 :] if markers.tag("watchdog") in c.body)

    def escalate(self, item: Issue, state: str) -> None:
        n, gh, s, retries = item.number, self.gh, self.s, self.cfg.retries
        nxt, who = ("agent:needs-human", "a human") if state == "agent:needs-decision" else ("agent:needs-decision", "the Lead")
        self.act(f"transition {n} {nxt}", transition, gh, s, n, nxt)
        self.act(
            f"comment {n}",
            gh.comment,
            n,
            f"<!-- agent:watchdog-escalation -->\n⏰ Still no progress in `{state}` after {retries} watchdog retries. Handing to {who}.",
        )
        self.act(f"progress {n}", progress, gh, s, f"⏰ **Watchdog**: stalled in `{state}` after {retries} retries, handed to {who}", **_where(item))

    def plan(self, n: int, state: str) -> tuple[str, str, str]:
        """(the state to re-apply, a note for the comment, a short note for the progress log)."""
        if state == "none":
            return "agent:review", "Asking the Reviewer", "asked the Reviewer"
        if state == "agent:fixing":
            return "agent:changes-requested", "Restarting the Implementor", "restarted the Implementor"
        if state == "agent:in-progress":
            opened = self.gh.prs("open", head=f"agent/issue-{n}")
            if opened:
                p = opened[0].number
                return "agent:pr-open", f"The Implementor had already opened #{p}, so continuing with it", f"continuing with #{p}"
            return "agent:ready", "Restarting the Implementor", "restarted the Implementor"
        return state, "Re-triggering it", "re-triggered"

    def retry(self, item: Issue, state: str, age: int, tried: int) -> None:
        n, gh, s, retries = item.number, self.gh, self.s, self.cfg.retries
        nxt, note, short = self.plan(n, state)
        shown = "review pending" if state == "none" else state
        self.act(f"transition {n} {nxt}", transition, gh, s, n, nxt)
        self.act(
            f"comment {n}",
            gh.comment,
            n,
            f"<!-- agent:watchdog -->\n⏰ No progress for {age} minutes in `{shown}`, and no agent run is active. "
            f"The last run was probably cancelled or crashed. {note} (retry {tried + 1} of {retries}).",
        )
        self.act(f"progress {n}", progress, gh, s, f"⏰ **Watchdog**: stalled {age}m in `{shown}`, {short} (retry {tried + 1}/{retries})", **_where(item))

    def merge_queue(self) -> None:
        """Queued PRs wait on purpose, but only while an Integrator run is queued or running (each run
        drains the whole queue). Without one, re-applying agent:queued to the front PR starts one; it
        keeps its place (the order comes from its admission comment)."""
        if not self.cfg.dry_run:
            self.out += queue.tidy(self.gh, self.s)
        waiting = queue.order(self.gh, self.s)
        if not waiting:
            return
        if any(self.gh.runs(status, "agent-integrator.yml") for status in INTEGRATOR_ACTIVE):
            self.out.append(f"Merge queue: {len(waiting)} PR(s), an Integrator run is active")
            return
        front = waiting[0][0]
        self.out.append(f"Merge queue: {len(waiting)} PR(s) but no Integrator run, restarting it at #{front}")
        self.act(f"transition {front} agent:queued", transition, self.gh, self.s, front, "agent:queued")
        self.act(f"progress {front}", progress, self.gh, self.s, "⏰ **Watchdog**: the merge queue had no Integrator run, restarted it", pr=front)


def _where(item: Issue) -> dict[str, int]:
    """Where its progress line goes: the issue itself, or the issue a PR closes."""
    return {"pr": item.number} if item.is_pr else {"issue": item.number}


def check(gh: GitHub, s: Settings, cfg: WatchConfig, *, clock: Clock | None = None) -> list[str]:
    """One watchdog pass. Returns what it found and did, line by line, in the order of the items."""
    w = _Watch(gh, s, cfg, clock or SystemClock(), [])
    now = w.clock.now()
    active = {r.title for status in ACTIVE for r in gh.runs(status) if r.workflow.startswith("Agent")}
    stalled = 0
    for item in gh.open_items():
        found = w.examine(item, now, active)
        if found is None:
            continue
        state, age = found
        stalled += 1
        tried = w.retries_so_far(item.number)
        w.out.append(f"#{item.number} ({'pr' if item.is_pr else 'issue'}) stalled in {state} for {age}m, retries so far: {tried}")
        if tried >= cfg.retries:
            w.escalate(item, state)
        else:
            w.retry(item, state, age, tried)
    w.out.append(f"Stalled items: {stalled}")
    # Conflict avoidance: issues waiting for overlapping work start once it merged or closed, or waited too long.
    if cfg.avoid_conflicts and not cfg.dry_run:
        w.out += overlap.release_waiting(gh, s, cfg.conflict_wait_minutes, cfg.conflict_ignore, w.clock)
    if cfg.auto_merge:
        w.merge_queue()
    return w.out
