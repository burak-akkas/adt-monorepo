"""The GitHub records the agent tooling works with, as plain immutable values."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

Resolution = Literal["open", "done", "dropped"]


@dataclass(frozen=True)
class Comment:
    id: int
    author_id: int
    body: str
    created_at: str  # ISO 8601 in UTC, so comparing strings compares times


@dataclass(frozen=True)
class LabelEvent:
    label: str
    created_at: str


@dataclass(frozen=True)
class Issue:
    """An issue or a pull request (GitHub's issues API returns both)."""

    number: int
    id: int  # the REST id, which the sub-issues API wants
    title: str
    body: str
    state: str  # "open" or "closed"
    state_reason: str | None
    author_id: int
    labels: tuple[str, ...]
    is_pr: bool
    is_draft: bool = False  # only known from listings (open_items)

    @property
    def is_open(self) -> bool:
        return self.state == "open"

    @property
    def resolution(self) -> Resolution:
        """How work that waits for this issue should treat it: still open, done, or dropped.
        Closed as not planned is dropped; any other closed issue (completed, duplicate, or closed
        without a reason) is done, so nothing waits forever for an issue nobody will reopen."""
        if self.is_open:
            return "open"
        return "dropped" if self.state_reason == "not_planned" else "done"


@dataclass(frozen=True)
class PullRequest:
    number: int
    state: str  # "OPEN", "CLOSED" or "MERGED" (gh pr view's spelling)
    is_draft: bool
    head_sha: str
    head_ref: str
    base_ref: str
    labels: tuple[str, ...]
    title: str

    @property
    def is_open(self) -> bool:
        return self.state == "OPEN"

    @property
    def is_agent_branch(self) -> bool:
        return self.head_ref.startswith("agent/")


@dataclass(frozen=True)
class FileChange:
    """One file in a compare (base...head): what GitHub's compare API says about it."""

    filename: str
    status: str
    patch: str | None  # None for binary or too large files
    previous_filename: str | None
    changes: int


@dataclass(frozen=True)
class Commit:
    sha: str
    parents: tuple[str, ...]
    author_id: int | None  # the GitHub user, if the author maps to one
    committer_login: str | None
    verified: bool
