"""Handoff markers: the `<!-- agent:… -->` comments the agents leave on issues and PRs.

Only the bot's own comments count, so nobody else can forge a marker. Comments are always in the
order GitHub returns them (oldest first), so "newer" means "later in the list".
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Sequence

from agentflow.model import Comment

_SUB_ISSUE = re.compile(r"<!-- agent:sub-issue parent=(\d+) depends=([0-9,]*)")


def tag(role: str) -> str:
    """The plain marker of a role or event, e.g. tag("lead") == "<!-- agent:lead -->"."""
    return f"<!-- agent:{role} -->"


def from_bot(comments: Iterable[Comment], bot_id: int | None) -> list[Comment]:
    """The comments the bot wrote (all of them when no bot id is configured)."""
    return [c for c in comments if bot_id is None or c.author_id == bot_id]


def count(comments: Iterable[Comment], bot_id: int, role: str) -> int:
    marker = tag(role)
    return sum(1 for c in from_bot(comments, bot_id) if marker in c.body)


def last_index(comments: Sequence[Comment], needle: str) -> int:
    """Position of the newest comment containing needle, -1 if none."""
    for i in range(len(comments) - 1, -1, -1):
        if needle in comments[i].body:
            return i
    return -1


def newer(comments: Sequence[Comment], needle: str, than: str) -> bool:
    """Is there a comment with needle after the newest one with `than`?"""
    i = last_index(comments, needle)
    return i >= 0 and i > last_index(comments, than)


def latest_value(comments: Iterable[Comment], name: str, value: str = r"[0-9,]+") -> str | None:
    """The payload of the newest `<!-- agent:<name> <value> -->` marker, e.g. "54,60" for waits-on."""
    pattern = re.compile(rf"<!-- agent:{re.escape(name)} ({value}) -->")
    found = [m.group(1) for c in comments for m in pattern.finditer(c.body)]
    return found[-1] if found else None


def numbers(value: str | None) -> list[int]:
    """'54,60' -> [54, 60]."""
    return [int(x) for x in (value or "").split(",") if x.strip().isdigit()]


def sub_issue(body: str) -> tuple[int, list[int]] | None:
    """(parent, depends_on) from a sub-issue's body, None if it has no sub-issue marker."""
    m = _SUB_ISSUE.search(body)
    return (int(m.group(1)), numbers(m.group(2))) if m else None


def split_children(bot_comments: Iterable[Comment]) -> list[int]:
    """The sub-issues of a split issue, from the newest `<!-- agent:split 47,48 -->` marker."""
    return numbers(latest_value(bot_comments, "split"))
