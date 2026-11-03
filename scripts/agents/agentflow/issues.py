"""The issue pipeline before a PR exists: the Lead's budget, splitting issues into sub-issues,
advancing split issues, and restarting issues that waited for others."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Literal

from agentflow import labels, markers
from agentflow.config import Settings
from agentflow.github import GhError, GitHub
from agentflow.model import Issue
from agentflow.states import progress, transition

ARCHITECT, LEAD = markers.tag("architect"), markers.tag("lead")
SPLIT_REQUIRED = markers.tag("split-required")
WAITS_ON = "<!-- agent:waits-on "


def refs(numbers: Sequence[int], sep: str = " ") -> str:
    """[47, 48] -> "#47 #48" (or with another separator)."""
    return sep.join(f"#{n}" for n in numbers)


# --- the Lead's budget -------------------------------------------------------------------------------
def lead_budget(gh: GitHub, s: Settings, number: int) -> int:
    """Lead decisions that count against the budget: the bot's `agent:lead` comments since the item was
    last labeled `agent:needs-human`. A human sending an escalated item back gives the Lead a fresh
    budget; only a human takes an item out of `agent:needs-human`, so this can't loop."""
    since = max((e.created_at for e in gh.label_events(number) if e.label == "agent:needs-human"), default="")
    return sum(1 for c in markers.from_bot(gh.comments(number), s.bot) if LEAD in c.body and c.created_at > since)


# --- splitting ---------------------------------------------------------------------------------------
@dataclass(frozen=True)
class SplitMode:
    """allowed: the Architect decides; required: the Lead or the size check asked for a split after
    the latest design; not-allowed: splitting is off or the issue is too deep (reason says which)."""

    kind: Literal["allowed", "required", "not-allowed"]
    reason: str = ""

    def __str__(self) -> str:
        return f"{self.kind} {self.reason}" if self.reason else self.kind


MAX_PARENT_HOPS = 10  # a parent chain longer than this is broken (or a cycle): stop following it


def depth(gh: GitHub, s: Settings, number: int) -> int:
    """How many levels of sub-issues deep an issue is, following the sub-issue markers of issues the
    bot created, so nobody can fake or hide a parent by editing an issue body."""
    level, current = 0, number
    while level < MAX_PARENT_HOPS:
        issue = gh.issue(current)
        parsed = markers.sub_issue(issue.body) if issue.author_id == s.bot else None
        if parsed is None:
            break
        level, current = level + 1, parsed[0]
    return level


def split_mode(gh: GitHub, s: Settings, number: int, *, enabled: bool = True, max_depth: int = 2) -> SplitMode:
    if not enabled:
        return SplitMode("not-allowed", "splitting is turned off (AGENT_SPLIT)")
    d = depth(gh, s, number)
    if d >= max_depth:
        return SplitMode("not-allowed", f"this issue is already {d} level(s) of sub-issues deep (AGENT_MAX_SPLIT_DEPTH is {max_depth})")
    mine = markers.from_bot(gh.comments(number), s.bot)
    return SplitMode("required" if markers.newer(mine, SPLIT_REQUIRED, ARCHITECT) else "allowed")


class SplitError(Exception):
    """The Architect's split plan can't be used."""


def _check_plan(plan: Mapping[str, Any], max_subissues: int) -> list[Mapping[str, Any]]:
    subtasks = list(plan.get("subtasks") or [])
    if not 2 <= len(subtasks) <= max_subissues:
        raise SplitError(f"Split plan has {len(subtasks)} subtasks; expected 2 to {max_subissues}")
    # depends_on holds 1-based positions of *earlier* subtasks, which keeps the graph acyclic.
    bad = sum(1 for i, t in enumerate(subtasks) for d in t.get("depends_on") or [] if not 1 <= d <= i)
    if bad:
        raise SplitError(f"Split plan has {bad} dependencies that don't point to an earlier subtask")
    return subtasks


def _sub_issue_body(summary: str, parent: int, deps: Sequence[int]) -> str:
    waits = f"Depends on: {refs(deps, ', ')} (starts when they are done).\n" if deps else ""
    return f"{summary}\n\nPart of #{parent}.\n{waits}\n<!-- agent:sub-issue parent={parent} depends={','.join(map(str, deps))} -->\n"


def _analysis(summary: str, parent: int, criteria: Sequence[str]) -> str:
    checklist = "".join(f"- [ ] {c}\n" for c in criteria)
    return (
        f"{markers.tag('analyst')}\n## 🔍 Analyst\n\n"
        f"_Split from #{parent} by the Architect. The parent's `agent:architect` comment holds the overall design._\n\n"
        f"**Problem statement**\n{summary}\n\n**Acceptance criteria**\n{checklist}\n"
        f"**Out of scope**\n- The other parts of #{parent}, each handled in its own sub-issue.\n"
    )


def split(gh: GitHub, s: Settings, parent: int, plan: Mapping[str, Any], max_subissues: int = 5, *, out: list[str] | None = None) -> list[str]:
    """Splits a parent issue into sub-issues, following the Architect's plan
    ({"subtasks": [{"title", "summary", "acceptance_criteria", "depends_on"}]}).

    Each sub-issue gets the plan's acceptance criteria as an `agent:analyst` comment, so every later
    role works on it exactly as on a normal issue. Sub-issues without dependencies go straight to the
    Architect (`agent:analyzed`); the others wait in `agent:blocked` until `advance` unblocks them.
    The parent waits in `agent:split` and closes when they are all done.
    """
    subtasks = _check_plan(plan, max_subissues)
    labels.ensure(gh, "agent:split", "agent:blocked")
    out = [] if out is None else out  # filled as it goes, so a caller sees what was created if it fails midway
    created: list[int] = []
    rows: list[str] = []
    for task in subtasks:
        title, summary = str(task["title"]), str(task["summary"])
        deps = [created[d - 1] for d in task.get("depends_on") or []]
        n = gh.create_issue(title, _sub_issue_body(summary, parent, deps))
        created.append(n)
        out.append(f"Created #{n}: {title}")
        gh.comment(n, _analysis(summary, parent, [str(c) for c in task.get("acceptance_criteria") or []]))
        # A real GitHub sub-issue shows progress on the parent. Best effort: the markers are the source of truth.
        try:
            gh.link_sub_issue(parent, gh.issue(n).id)
        except GhError:
            out.append(f"::warning::Could not link #{n} as a sub-issue of #{parent}")
        transition(gh, s, n, "agent:blocked" if deps else "agent:analyzed")
        rows.append(f"- [ ] #{n} {title} " + (f"(waits for {refs(deps, ', ')})" if deps else "(starts now)"))
    rows_text = "\n".join(rows)
    gh.comment(
        parent,
        f"<!-- agent:split {','.join(map(str, created))} -->\n## 🧩 Split into {len(created)} sub-issues\n\n{rows_text}\n\n"
        "Each sub-issue goes through the pipeline on its own (design, PR, review, QA, merge). Independent ones run in parallel.\n"
        "This issue closes automatically when all of them are done.\n",
    )
    transition(gh, s, parent, "agent:split")
    out.append(f"Split #{parent} into {refs(created, ', ')}")
    return out


# --- advancing split issues --------------------------------------------------------------------------
def _waits_outside(gh: GitHub, s: Settings, number: int) -> bool:
    """Parked by the Implementor on an outside dependency (release_blocked restarts it)."""
    return any(WAITS_ON in c.body for c in markers.from_bot(gh.comments(number), s.bot))


def advance(gh: GitHub, s: Settings, parent: int, closed: int | None = None) -> list[str]:
    """Advances a split issue: unblocks sub-issues whose dependencies are all done, closes the parent
    once every sub-issue is done, and hands the parent to the Lead (once) when one was dropped."""
    children = markers.split_children(markers.from_bot(gh.comments(parent), s.bot))
    if not children:
        return [f"::warning::#{parent} has no split marker"]
    issues: dict[int, Issue] = {c: gh.issue(c) for c in children}
    done = {c for c, i in issues.items() if i.resolution == "done"}
    dropped = [c for c, i in issues.items() if i.resolution == "dropped"]

    if dropped:
        # Hand over once: after this the parent is no longer agent:split, so the sweep leaves it alone.
        if "agent:split" not in gh.labels(parent):
            return []
        transition(gh, s, parent, "agent:needs-decision")
        gh.comment(
            parent,
            f"⚠️ Sub-issue(s) {refs(dropped)} were closed as **not planned**. Sub-issues that depend on them stay blocked. "
            "Lead: decide whether to unblock them (apply `agent:analyzed`), close them, or close this issue.",
        )
        return [f"#{parent}: sub-issues closed as not planned, handed to the Lead"]

    out: list[str] = []
    remaining = [c for c in children if c not in done]
    for c in remaining:
        child = issues[c]
        if not child.is_open or "agent:blocked" not in child.labels or _waits_outside(gh, s, c):
            continue
        deps = (markers.sub_issue(child.body) or (parent, []))[1]
        if all(d in done for d in deps):
            transition(gh, s, c, "agent:analyzed")
            progress(gh, s, "🧩 **Unblocked**: its dependencies are done, starting design", issue=c)
            progress(gh, s, f"🧩 {f'#{closed} done, ' if closed else ''}**#{c}** unblocked", issue=parent)
            out.append(f"Unblocked #{c}")

    if not remaining:
        if not gh.issue(parent).is_open:
            return out
        listing = "\n".join(f"- #{c}" for c in children)
        gh.comment(parent, f"✅ All sub-issues are done:\n{listing}\n\nClosing this issue.")
        transition(gh, s, parent, "agent:done")
        gh.close_issue(parent, "completed")
        progress(gh, s, "✅ **All sub-issues done**, closed", issue=parent)
        out.append(f"Closed #{parent}")
    elif closed:
        progress(gh, s, f"🧩 #{closed} done, {len(remaining)} sub-issue(s) left", issue=parent)
    return out


def sub_issue_closed(gh: GitHub, s: Settings, closed: int) -> list[str]:
    """Advances the parent of a sub-issue that just closed (nothing for any other issue)."""
    issue = gh.issue(closed)
    if issue.author_id != s.bot:
        return [f"#{closed} was not created by the agents' bot, nothing to do"]
    parsed = markers.sub_issue(issue.body)
    if parsed is None:
        return [f"#{closed} is not a sub-issue"]
    return advance(gh, s, parsed[0], closed)


def sweep(gh: GitHub, s: Settings) -> list[str]:
    """Advances every open split issue. Makes the closing workflow self-healing: GitHub keeps one
    pending run per concurrency group, so a run for one closure can be dropped."""
    out = [line for p in gh.open_issues("agent:split") for line in advance(gh, s, p)]
    return [*out, "Swept open split issues"]


# --- issues waiting for other issues -----------------------------------------------------------------
def release_blocked(gh: GitHub, s: Settings) -> list[str]:
    """Restarts issues the Implementor parked in `agent:blocked` with a `<!-- agent:waits-on 54,60 -->`
    comment (the newest counts): back to `agent:ready` once every listed issue is done, to the Lead
    when one was dropped, otherwise they keep waiting. Sub-issues blocked by their siblings carry no
    waits-on marker; `advance` handles those."""
    out: list[str] = []
    for n in gh.open_issues("agent:blocked"):
        deps = markers.numbers(markers.latest_value(markers.from_bot(gh.comments(n), s.bot), "waits-on"))
        if not deps:
            continue
        state = {d: gh.issue(d).resolution for d in deps}
        dropped = [d for d in deps if state[d] == "dropped"]
        waiting = [d for d in deps if state[d] == "open"]
        if dropped:
            transition(gh, s, n, "agent:needs-decision")
            gh.comment(n, f"⚠️ This issue waited for {refs(dropped)}, which was closed as **not planned**. Lead: decide whether it can go ahead without it.")
            progress(gh, s, f"🧩 **Dependency dropped**: {refs(dropped)} closed as not planned, handed to the Lead", issue=n)
            out.append(f"#{n}: dependency {refs(dropped)} dropped, handed to the Lead")
        elif not waiting:
            transition(gh, s, n, "agent:ready")
            progress(gh, s, f"🧩 **Unblocked**: {refs(deps)} done, implementing", issue=n)
            out.append(f"#{n}: dependencies done, back to the Implementor")
        else:
            out.append(f"#{n} still waits for {refs(waiting)}")
    return out
