"""GitHub access for the agent tooling.

`GitHub` is the interface the commands use; `GhCli` implements it with the `gh` CLI, so the
workflows' token and the simulator's fake `gh` (scripts/sim/fakegh) both work unchanged.
"""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
import urllib.parse
from abc import ABC, abstractmethod
from collections.abc import Callable
from typing import Any

from agentflow.model import Check, Comment, Commit, FileChange, Issue, LabelEvent, PullRequest, Run

Runner = Callable[[list[str], "str | None"], str]


class GhError(Exception):
    """A `gh` call failed (API error, network, missing item). `stdout` keeps what it printed anyway:
    `gh pr checks` exits non-zero while checks are pending or failing, and still prints them."""

    def __init__(self, message: str, stdout: str = "") -> None:
        super().__init__(message)
        self.stdout = stdout


class GitHub(ABC):
    @abstractmethod
    def issue(self, number: int) -> Issue: ...

    @abstractmethod
    def labels(self, number: int) -> list[str]: ...

    @abstractmethod
    def add_label(self, number: int, label: str) -> None: ...

    @abstractmethod
    def remove_label(self, number: int, label: str) -> None: ...

    @abstractmethod
    def comments(self, number: int) -> list[Comment]: ...

    @abstractmethod
    def comment(self, number: int, body: str) -> None: ...

    @abstractmethod
    def edit_comment(self, comment_id: int, body: str) -> None: ...

    @abstractmethod
    def label_events(self, number: int) -> list[LabelEvent]:
        """When labels were applied (`labeled` events only), oldest first."""

    @abstractmethod
    def assign(self, number: int, login: str) -> None: ...

    @abstractmethod
    def open_issues(self, label: str) -> list[int]:
        """Open issues (not PRs) carrying a label."""

    @abstractmethod
    def create_issue(self, title: str, body: str) -> int: ...

    @abstractmethod
    def close_issue(self, number: int, reason: str) -> None:
        """reason: "completed" or "not planned", as `gh issue close --reason` takes it."""

    @abstractmethod
    def link_sub_issue(self, parent: int, child_id: int) -> None: ...

    @abstractmethod
    def create_label(self, name: str, color: str, description: str) -> None: ...

    @abstractmethod
    def pr_closing_issue(self, pr: int) -> int | None:
        """The issue a PR closes (its first closing reference), if any."""

    # --- pull requests and code ------------------------------------------------------------------
    @abstractmethod
    def pr(self, number: int) -> PullRequest: ...

    @abstractmethod
    def pr_mergeable(self, number: int) -> str:
        """MERGEABLE, CONFLICTING or UNKNOWN (GitHub computes it lazily: retry UNKNOWN)."""

    @abstractmethod
    def prs(self, state: str = "open", label: str | None = None, base: str | None = None, head: str | None = None) -> list[PullRequest]:
        """Pull requests by state ("open" or "all"), optionally with a label, a base or a head branch."""

    @abstractmethod
    def pr_files(self, number: int) -> list[str]:
        """The files a PR changes."""

    @abstractmethod
    def compare_files(self, base: str, head: str) -> list[FileChange]:
        """The changes of base...head (from their merge base, like a PR's diff)."""

    @abstractmethod
    def compare_status(self, a: str, b: str) -> str:
        """How b relates to a: identical, ahead, behind or diverged."""

    @abstractmethod
    def commit(self, sha: str) -> Commit: ...

    @abstractmethod
    def open_items(self) -> list[Issue]:
        """Every open issue and PR (PRs with is_draft set)."""

    @abstractmethod
    def runs(self, status: str, workflow_file: str | None = None) -> list[Run]:
        """Workflow runs in a status (queued, in_progress, …), of one workflow file or all of them."""

    @abstractmethod
    def behind_by(self, sha: str, base: str) -> int:
        """How many commits of `base` are missing from `sha`."""

    @abstractmethod
    def pr_checks(self, number: int) -> list[Check]: ...

    @abstractmethod
    def close_pr(self, number: int) -> None:
        """Closes a PR without merging it, and deletes its branch."""

    @abstractmethod
    def mark_ready(self, number: int) -> None:
        """Turns a draft PR into one ready for review."""

    @abstractmethod
    def pr_stats(self, number: int) -> str:
        """The size of a PR, as "+12/-3, 4 files" (with a minus sign)."""

    @abstractmethod
    def deployment_urls(self, sha: str, environment: str = "") -> list[str]:
        """The URLs of this commit's deployments whose latest status is success (in `environment`, if set)."""

    @abstractmethod
    def branch_head(self, branch: str) -> str:
        """The commit a branch points to."""

    @abstractmethod
    def update_branch(self, number: int, expected_head: str) -> None:
        """Merges the base into the PR (GitHub's update-branch); fails if the head moved or GitHub refuses."""

    @abstractmethod
    def merge(self, number: int, method: str, head: str) -> str:
        """Merges the PR at exactly `head` (and deletes the branch). Returns gh's error output, "" if none.
        Never raises: gh can report an error after the merge itself succeeded, so callers check the state."""


def run_gh(args: list[str], stdin: str | None = None) -> str:
    try:
        p = subprocess.run(["gh", *args], input=stdin, capture_output=True, text=True, check=False)
    except OSError as e:
        raise GhError(f"cannot run gh: {e}") from e
    if p.returncode != 0:
        raise GhError(p.stderr.strip() or f"gh {' '.join(args[:3])} exited with {p.returncode}", p.stdout)
    return p.stdout


def _issue(data: dict[str, Any]) -> Issue:
    return Issue(
        number=int(data["number"]),
        id=int(data.get("id") or 0),
        title=data.get("title") or "",
        body=data.get("body") or "",
        state=data.get("state") or "open",
        state_reason=data.get("state_reason"),
        author_id=int((data.get("user") or {}).get("id") or 0),
        labels=tuple(label["name"] for label in data.get("labels") or []),
        is_pr=data.get("pull_request") is not None,  # GitHub sends an object for PRs; any object, even {}, means a PR
        is_draft=bool(data.get("draft")),
        updated_at=data.get("updated_at") or "",
    )


class GhCli(GitHub):
    def __init__(self, repo: str, runner: Runner = run_gh) -> None:
        self.repo = repo
        self._run = runner

    # --- plumbing ------------------------------------------------------------------------------
    def _path(self, *parts: object) -> str:
        return "/".join(["repos", self.repo, *map(str, parts)])

    def _json(self, args: list[str]) -> Any:
        out = self._run(args, None)
        try:
            return json.loads(out) if out.strip() else None
        except json.JSONDecodeError as e:
            raise GhError(f"gh {' '.join(args[:3])} returned no JSON: {out[:200]}") from e

    def _pages(self, path: str) -> list[dict[str, Any]]:
        pages = self._json(["api", "--paginate", "--slurp", path]) or []
        return [item for page in pages for item in page]

    # --- generic reads, for one-off tools (scripts/agents/agentflow/doctor.py) ------------------------
    def read(self, path: str) -> Any:
        """GET repos/<repo>/<path> (or another API path starting with "user/" …), as JSON."""
        if path.startswith(("user/", "users/")):
            return self._json(["api", path])
        return self._json(["api", self._path(path) if path else f"repos/{self.repo}"])

    def read_list(self, path: str, key: str) -> list[Any]:
        """All pages of a listing whose items sit under `key` (e.g. actions/variables -> "variables")."""
        pages = self._json(["api", "--paginate", "--slurp", self._path(path)]) or []
        return [item for page in pages for item in (page.get(key) or [] if isinstance(page, dict) else page)]

    def read_raw(self, path: str) -> str:
        """A file's raw contents through the contents API."""
        return self._run(["api", self._path(path), "-H", "Accept: application/vnd.github.raw"], None)

    # --- reads ---------------------------------------------------------------------------------
    def issue(self, number: int) -> Issue:
        return _issue(self._json(["api", self._path("issues", number)]))

    def labels(self, number: int) -> list[str]:
        return [label["name"] for label in self._json(["api", self._path("issues", number, "labels")]) or []]

    def comments(self, number: int) -> list[Comment]:
        return [
            Comment(id=int(c["id"]), author_id=int((c.get("user") or {}).get("id") or 0), body=c.get("body") or "", created_at=c.get("created_at") or "")
            for c in self._pages(self._path("issues", number, "comments"))
        ]

    def label_events(self, number: int) -> list[LabelEvent]:
        return [
            LabelEvent(label=e["label"]["name"], created_at=e.get("created_at") or "")
            for e in self._pages(self._path("issues", number, "events"))
            if e.get("event") == "labeled" and e.get("label")
        ]

    def open_issues(self, label: str) -> list[int]:
        rows = self._json(["issue", "list", "-R", self.repo, "--state", "open", "--label", label, "--limit", "100", "--json", "number"])
        return [int(r["number"]) for r in rows or []]

    def pr_closing_issue(self, pr: int) -> int | None:
        refs = (self._json(["pr", "view", str(pr), "-R", self.repo, "--json", "closingIssuesReferences"]) or {}).get("closingIssuesReferences") or []
        return int(refs[0]["number"]) if refs else None

    # --- writes --------------------------------------------------------------------------------
    def add_label(self, number: int, label: str) -> None:
        self._run(["api", "-X", "POST", self._path("issues", number, "labels"), "-f", "labels[]=" + label], None)

    def remove_label(self, number: int, label: str) -> None:
        self._run(["api", "-X", "DELETE", self._path("issues", number, "labels", urllib.parse.quote(label, safe=""))], None)

    def comment(self, number: int, body: str) -> None:
        self._run(["api", self._path("issues", number, "comments"), "-f", "body=" + body], None)

    def edit_comment(self, comment_id: int, body: str) -> None:
        self._run(["api", "-X", "PATCH", self._path("issues", "comments", comment_id), "-f", "body=" + body], None)

    def assign(self, number: int, login: str) -> None:
        self._run(["api", "-X", "POST", self._path("issues", number, "assignees"), "-f", "assignees[]=" + login], None)

    def create_issue(self, title: str, body: str) -> int:
        fd, path = tempfile.mkstemp(prefix="agentflow-", suffix=".md")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write(body)
            url = self._run(["issue", "create", "-R", self.repo, "--title", title, "--body-file", path], None).strip()
        finally:
            os.unlink(path)
        try:
            return int(url.rstrip("/").rsplit("/", 1)[-1])
        except ValueError:
            raise GhError(f"gh issue create printed no issue URL: {url!r}") from None

    def close_issue(self, number: int, reason: str) -> None:
        self._run(["issue", "close", str(number), "-R", self.repo, "--reason", reason], None)

    def link_sub_issue(self, parent: int, child_id: int) -> None:
        self._run(["api", "-X", "POST", self._path("issues", parent, "sub_issues"), "-F", f"sub_issue_id={child_id}"], None)

    def create_label(self, name: str, color: str, description: str) -> None:
        self._run(["label", "create", name, "-R", self.repo, "--color", color, "--description", description, "--force"], None)

    # --- pull requests and code ------------------------------------------------------------------
    PR_FIELDS = "number,state,isDraft,headRefOid,headRefName,baseRefName,labels,title"

    @staticmethod
    def _pull(d: dict[str, Any]) -> PullRequest:
        return PullRequest(
            number=int(d["number"]),
            state=d.get("state") or "OPEN",
            is_draft=bool(d.get("isDraft")),
            head_sha=d.get("headRefOid") or "",
            head_ref=d.get("headRefName") or "",
            base_ref=d.get("baseRefName") or "",
            labels=tuple(label["name"] for label in d.get("labels") or []),
            title=d.get("title") or "",
        )

    def pr(self, number: int) -> PullRequest:
        return self._pull(self._json(["pr", "view", str(number), "-R", self.repo, "--json", self.PR_FIELDS]))

    def pr_mergeable(self, number: int) -> str:
        return str((self._json(["pr", "view", str(number), "-R", self.repo, "--json", "mergeable"]) or {}).get("mergeable") or "UNKNOWN")

    def prs(self, state: str = "open", label: str | None = None, base: str | None = None, head: str | None = None) -> list[PullRequest]:
        args = ["pr", "list", "-R", self.repo, "--state", state, "--limit", "100", "--json", self.PR_FIELDS]
        for flag, value in (("--label", label), ("--base", base), ("--head", head)):
            if value:
                args += [flag, value]
        return [self._pull(d) for d in self._json(args) or []]

    def pr_files(self, number: int) -> list[str]:
        return [f["filename"] for f in self._pages(self._path("pulls", number, "files") + "?per_page=100")]

    def _compare(self, a: str, b: str) -> dict[str, Any]:
        return dict(self._json(["api", self._path("compare", f"{a}...{b}")]) or {})

    def compare_files(self, base: str, head: str) -> list[FileChange]:
        return [
            FileChange(
                filename=f["filename"],
                status=f.get("status") or "",
                patch=f.get("patch"),
                previous_filename=f.get("previous_filename"),
                changes=int(f.get("changes") or 0),
            )
            for f in self._compare(base, head).get("files") or []
        ]

    def compare_status(self, a: str, b: str) -> str:
        return str(self._compare(a, b).get("status") or "")

    def commit(self, sha: str) -> Commit:
        d = self._json(["api", self._path("commits", sha)]) or {}
        return Commit(
            sha=sha,
            parents=tuple(p["sha"] for p in d.get("parents") or []),
            author_id=(d.get("author") or {}).get("id"),
            committer_login=(d.get("committer") or {}).get("login"),
            verified=bool(((d.get("commit") or {}).get("verification") or {}).get("verified")),
        )

    def open_items(self) -> list[Issue]:
        return [_issue(d) for d in self._pages(self._path("issues") + "?state=open&per_page=100")]

    def runs(self, status: str, workflow_file: str | None = None) -> list[Run]:
        args = ["run", "list", "-R", self.repo, "--status", status, "--limit", "100", "--json", "name,displayTitle"]
        if workflow_file:
            args += ["--workflow", workflow_file]
        return [Run(workflow=str(r.get("name") or ""), title=str(r.get("displayTitle") or "")) for r in self._json(args) or []]

    def behind_by(self, sha: str, base: str) -> int:
        return int(self._compare(sha, base).get("ahead_by") or 0)

    def pr_checks(self, number: int) -> list[Check]:
        args = ["pr", "checks", str(number), "-R", self.repo, "--json", "workflow,name,bucket,link"]
        try:
            out = self._run(args, None)
        except GhError as e:
            out = e.stdout  # non-zero while checks are pending or failing, with the checks on stdout
        try:
            rows = json.loads(out) if out.strip() else []
        except json.JSONDecodeError:
            rows = []
        return [Check(str(r.get("workflow") or ""), str(r.get("name") or ""), str(r.get("bucket") or ""), str(r.get("link") or "")) for r in rows]

    def close_pr(self, number: int) -> None:
        self._run(["pr", "close", str(number), "-R", self.repo, "--delete-branch"], None)

    def mark_ready(self, number: int) -> None:
        self._run(["pr", "ready", str(number), "-R", self.repo], None)

    def pr_stats(self, number: int) -> str:
        d = self._json(["pr", "view", str(number), "-R", self.repo, "--json", "additions,deletions,changedFiles"]) or {}
        shown = {k: "null" if d.get(k) is None else d[k] for k in ("additions", "deletions", "changedFiles")}  # as jq prints a missing value
        return f"+{shown['additions']}/−{shown['deletions']}, {shown['changedFiles']} files"

    def deployment_urls(self, sha: str, environment: str = "") -> list[str]:
        urls: list[str] = []
        for d in self._json(["api", self._path("deployments") + f"?sha={sha}&per_page=30"]) or []:
            if environment and d.get("environment") != environment:
                continue
            try:
                latest = (self._json(["api", f"{d['statuses_url']}?per_page=1"]) or [{}])[0]
            except GhError:
                continue
            if latest.get("state") == "success" and latest.get("environment_url"):
                urls.append(str(latest["environment_url"]))
        return urls

    def branch_head(self, branch: str) -> str:
        return str(((self._json(["api", self._path("branches", branch)]) or {}).get("commit") or {}).get("sha") or "")

    def update_branch(self, number: int, expected_head: str) -> None:
        self._run(["api", "-X", "PUT", self._path("pulls", number, "update-branch"), "-f", f"expected_head_sha={expected_head}"], None)

    def merge(self, number: int, method: str, head: str) -> str:
        try:
            self._run(["pr", "merge", str(number), "-R", self.repo, f"--{method}", "--delete-branch", "--match-head-commit", head], None)
        except GhError as e:
            return str(e)
        return ""
