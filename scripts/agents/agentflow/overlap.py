"""Conflict avoidance: two agent PRs that edit the same files conflict as soon as one merges, and each
conflict costs an Implementor run, a re-review and another trip through the merge queue. So an issue
whose design overlaps work in flight waits for that work to merge (agent:waiting), then starts from
code that contains it."""

from __future__ import annotations

import contextlib
import json
from datetime import datetime, timezone
from fnmatch import fnmatchcase

from agentflow import markers
from agentflow.clock import Clock, SystemClock
from agentflow.config import Settings
from agentflow.github import GhError, GitHub
from agentflow.issues import refs
from agentflow.states import progress, transition

# Files that don't count: lockfiles and changelogs, which every PR touches and that merge without trouble.
DEFAULT_IGNORE = "*package-lock.json|*pnpm-lock.yaml|*yarn.lock|*Cargo.lock|*poetry.lock|*uv.lock|*go.sum|*CHANGELOG.md"
IN_FLIGHT = ("agent:ready", "agent:in-progress")


def planned_files(gh: GitHub, s: Settings, issue: int) -> list[str]:
    """The files the latest design plans to change (the Architect workflow's `<!-- agent:files [...] -->`)."""
    found = markers.latest_value(markers.from_bot(gh.comments(issue), s.bot), "files", r"\[.*?\]")
    return [str(f) for f in json.loads(found)] if found else []


def blockers(gh: GitHub, s: Settings, issue: int, ignore: str = DEFAULT_IGNORE) -> list[tuple[int, list[str]]]:
    """In-flight work that changes files this issue's design plans to change, as (number, files).

    In flight: open agent PRs (with the files they actually change), except drafts and PRs waiting for
    a human, and issues about to start or being implemented (with their planned files). An issue
    without planned files overlaps nothing. An error raises: it must never read as "no overlap"."""
    patterns = [p for p in ignore.split("|") if p]
    mine = sorted({f for f in planned_files(gh, s, issue) if not any(fnmatchcase(f, p) for p in patterns)})
    if not mine:
        return []
    out: list[tuple[int, list[str]]] = []
    for item in gh.open_items():
        if item.number == issue or "agent:needs-human" in item.labels:
            continue
        if item.is_pr:
            if item.is_draft:
                continue
            ref = gh.pr(item.number).head_ref
            if not ref.startswith("agent/") or ref == f"agent/issue-{issue}":
                continue
            theirs = set(gh.pr_files(item.number))
        elif any(label in IN_FLIGHT for label in item.labels):
            theirs = set(planned_files(gh, s, item.number))
        else:
            continue
        both = [f for f in mine if f in theirs]
        if both:
            out.append((item.number, both))
    return out


def _epoch(iso: str) -> float:
    return datetime.strptime(iso, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc).timestamp()


def release_waiting(gh: GitHub, s: Settings, max_minutes: int = 120, ignore: str = DEFAULT_IGNORE, clock: Clock | None = None) -> list[str]:
    """Starts waiting issues once nothing they overlap is in flight any more, oldest first, one at a
    time: an issue started here counts as in flight for the ones after it. After `max_minutes`
    (AGENT_CONFLICT_WAIT_MINUTES) an issue starts anyway: waiting is an optimization, never a reason
    to get stuck. Never fails."""
    clock = clock or SystemClock()
    out: list[str] = []
    try:
        waiting = sorted(i.number for i in gh.open_items() if not i.is_pr and "agent:waiting" in i.labels)
    except GhError:
        return out
    for n in waiting:
        try:
            since = max((e.created_at for e in gh.label_events(n) if e.label == "agent:waiting"), default="")
        except GhError:
            continue
        waited = int((clock.now() - (_epoch(since) if since else clock.now())) // 60)
        try:
            found = blockers(gh, s, n, ignore)
        except GhError:
            out.append(f"#{n}: couldn't check the overlap, trying again later")
            continue
        names = refs([b for b, _ in found])
        if found and waited < max_minutes:
            out.append(f"#{n} still waits ({waited}m): {names}")
            continue
        if found:
            why = f"it waited {waited} minutes (`AGENT_CONFLICT_WAIT_MINUTES` = {max_minutes}), so it starts anyway. Expect conflicts with {names}"
        else:
            why = "nothing in flight touches its planned files any more"
        try:
            transition(gh, s, n, "agent:ready")
        except GhError:
            continue
        with contextlib.suppress(GhError):
            gh.comment(n, f"▶️ **Conflict avoidance:** {why}. Starting the implementation from the latest code.")
        progress(gh, s, "▶️ **Conflict avoidance**: no longer waiting, implementing", issue=n)
        out.append(f"#{n} released: {why}")
    return out
