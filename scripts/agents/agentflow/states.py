"""The agent state of an issue or PR (its one `agent:*` label), and its progress log."""

from __future__ import annotations

import contextlib
from datetime import datetime, timezone

from agentflow import markers
from agentflow.config import Settings
from agentflow.github import GhError, GitHub

NEEDS_HUMAN = "agent:needs-human"
PROGRESS = markers.tag("progress")


def transition(gh: GitHub, s: Settings, number: int, new: str | None, now: datetime | None = None) -> str:
    """Moves an item to a new agent state: removes every `agent:*` label, then adds `new` (if any).

    The new label is removed too when already present: re-adding it fires a fresh `labeled` event,
    so repeating a state (e.g. a second approval) still triggers the next workflow. The labels are
    read first and a failed read fails, so an item never keeps its old state next to the new one.
    Escalating to a human also assigns AGENT_ESCALATION_ASSIGNEE and logs it in the progress comment.
    """
    for label in [x for x in gh.labels(number) if x.startswith("agent:")]:
        gh.remove_label(number, label)
    if new:
        gh.add_label(number, new)
    if new == NEEDS_HUMAN:
        if s.escalation_assignee:
            with contextlib.suppress(GhError):  # the escalation stands without the assignment
                gh.assign(number, s.escalation_assignee)
        if gh.issue(number).is_pr:
            progress(gh, s, f"👤 **Escalated to a human** on #{number}", pr=number, now=now)
        else:
            progress(gh, s, "👤 **Escalated to a human**", issue=number, now=now)
    return f"#{number} -> {new or '<cleared>'}"


def progress(gh: GitHub, s: Settings, line: str, *, issue: int | None = None, pr: int | None = None, now: datetime | None = None) -> None:
    """Appends a line to the issue's "📋 Agent progress" comment (created on first use), so the issue
    shows the whole pipeline even when the work happens on its PR (`pr`: log on the issue it closes).

    Never fails: the log is a convenience, not worth failing a step over. When the comments can't be
    read it skips the line rather than starting a second progress comment.
    """
    try:
        if pr is not None:
            issue = gh.pr_closing_issue(pr)
        if issue is None:
            return
        stamp = (now or datetime.now(timezone.utc)).strftime("%H:%M")
        entry = f"- `{stamp}` {line} · [run]({s.run_url})"
        mine = [c for c in markers.from_bot(gh.comments(issue), s.bot_id) if c.body.startswith(PROGRESS)]
        if mine:
            gh.edit_comment(mine[0].id, mine[0].body.rstrip("\n") + "\n" + entry)
        else:
            gh.comment(issue, f"{PROGRESS}\n### 📋 Agent progress\n{entry}")
    except GhError:
        pass
