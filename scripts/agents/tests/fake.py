"""An in-memory GitHub for unit tests: the same interface as agentflow.github.GhCli, no processes."""

from __future__ import annotations

import itertools
from dataclasses import dataclass, field, replace

from agentflow.github import GhError, GitHub
from agentflow.model import Comment, Issue, LabelEvent

BOT = 999
HUMAN = 1


@dataclass
class _Item:
    issue: Issue
    comments: list[Comment] = field(default_factory=list)
    events: list[LabelEvent] = field(default_factory=list)
    assignees: list[str] = field(default_factory=list)
    sub_issues: list[int] = field(default_factory=list)
    closing_issue: int | None = None


class FakeGitHub(GitHub):
    def __init__(self) -> None:
        self.items: dict[int, _Item] = {}
        self.labels_created: list[str] = []
        self.fail_on: set[str] = set()  # method names that raise GhError, for error paths
        self._clock = itertools.count(1)
        self._ids = itertools.count(1)

    # --- setting up ----------------------------------------------------------------------------
    def _now(self) -> str:
        t = next(self._clock)
        return f"2020-01-01T{t // 3600 % 24:02d}:{t // 60 % 60:02d}:{t % 60:02d}Z"

    def add_issue(
        self,
        number: int,
        *,
        labels: tuple[str, ...] = (),
        author: int = HUMAN,
        body: str = "",
        state: str = "open",
        reason: str | None = None,
        pr: bool = False,
        title: str = "",
    ) -> int:
        self.items[number] = _Item(
            Issue(
                number=number,
                id=10**6 + number,
                title=title or f"T{number}",
                body=body,
                state=state,
                state_reason=reason,
                author_id=author,
                labels=(),
                is_pr=pr,
            )
        )
        for label in labels:
            self.add_label(number, label)
        return number

    def say(self, number: int, body: str, author: int = BOT) -> None:
        self.items[number].comments.append(Comment(id=next(self._ids), author_id=author, body=body, created_at=self._now()))

    def bodies(self, number: int) -> list[str]:
        return [c.body for c in self.items[number].comments]

    def agent_labels(self, number: int) -> list[str]:
        return [label for label in self.items[number].issue.labels if label.startswith("agent:")]

    def _check(self, name: str) -> None:
        if name in self.fail_on:
            raise GhError(f"HTTP 502: injected failure in {name}")

    def _get(self, number: int) -> _Item:
        if number not in self.items:
            raise GhError(f"HTTP 404: Not Found (#{number})")
        return self.items[number]

    # --- the GitHub interface ------------------------------------------------------------------
    def issue(self, number: int) -> Issue:
        self._check("issue")
        return self._get(number).issue

    def labels(self, number: int) -> list[str]:
        self._check("labels")
        return list(self._get(number).issue.labels)

    def add_label(self, number: int, label: str) -> None:
        self._check("add_label")
        it = self._get(number)
        if label not in it.issue.labels:
            it.issue = replace(it.issue, labels=(*it.issue.labels, label))
        it.events.append(LabelEvent(label=label, created_at=self._now()))

    def remove_label(self, number: int, label: str) -> None:
        self._check("remove_label")
        it = self._get(number)
        it.issue = replace(it.issue, labels=tuple(x for x in it.issue.labels if x != label))

    def comments(self, number: int) -> list[Comment]:
        self._check("comments")
        return list(self._get(number).comments)

    def comment(self, number: int, body: str) -> None:
        self._check("comment")
        self.say(number, body, BOT)

    def edit_comment(self, comment_id: int, body: str) -> None:
        self._check("edit_comment")
        for it in self.items.values():
            for i, c in enumerate(it.comments):
                if c.id == comment_id:
                    it.comments[i] = replace(c, body=body)
                    return
        raise GhError(f"HTTP 404: comment {comment_id}")

    def label_events(self, number: int) -> list[LabelEvent]:
        self._check("label_events")
        return list(self._get(number).events)

    def assign(self, number: int, login: str) -> None:
        self._check("assign")
        self._get(number).assignees.append(login)

    def open_issues(self, label: str) -> list[int]:
        self._check("open_issues")
        return [n for n, it in sorted(self.items.items()) if not it.issue.is_pr and it.issue.state == "open" and label in it.issue.labels]

    def create_issue(self, title: str, body: str) -> int:
        self._check("create_issue")
        n = max(self.items, default=0) + 1
        self.add_issue(n, author=BOT, body=body, title=title)
        return n

    def close_issue(self, number: int, reason: str) -> None:
        self._check("close_issue")
        it = self._get(number)
        it.issue = replace(it.issue, state="closed", state_reason=reason)

    def link_sub_issue(self, parent: int, child_id: int) -> None:
        self._check("link_sub_issue")
        self._get(parent).sub_issues.append(child_id - 10**6)

    def create_label(self, name: str, color: str, description: str) -> None:
        self._check("create_label")
        self.labels_created.append(name)

    def pr_closing_issue(self, pr: int) -> int | None:
        self._check("pr_closing_issue")
        return self._get(pr).closing_issue
