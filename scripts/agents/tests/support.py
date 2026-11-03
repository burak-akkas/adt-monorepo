"""Test support: a fake repository for the unit tests, on the simulator's fake `gh`.

`Repo` is the real `GhCli`, with every `gh` call answered by scripts/sim/fakegh/gh (the one fake the
simulator uses too), so the tests check both the logic and the exact `gh` calls. Its builders write
the fake's state (scripts/sim/fakegh/gh describes the format); its readers check what a test did.
Anything the code needs from GitHub that the fake can't answer yet is added to the fake, not here.
"""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

from agentflow.github import GhCli, GhError
from agentflow.model import Commit, FileChange

FAKE_BIN = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "sim", "fakegh")
BOT = 999  # the fake's bot user id (AGENT_BOT_ID)
HUMAN = 1


def sha(n: int) -> str:
    return f"{n:040x}"


class Repo(GhCli):
    def __init__(self, base: str = "main") -> None:
        self._dir = tempfile.mkdtemp(prefix="agentflow-test-")
        self.state_file = os.path.join(self._dir, "state.json")
        self._save({"base": base, "base_version": 0, "items": {}, "shas": {}, "comments_all": [], "clock": 0, "events": []})
        super().__init__("o/r", runner=self._gh)

    # --- the fake gh ---------------------------------------------------------------------------
    def env(self) -> dict[str, str]:
        return {
            **os.environ,
            "PATH": FAKE_BIN + os.pathsep + os.environ.get("PATH", ""),
            "FAKE_GH_STATE": self.state_file,
            "FAKE_DATE_FILE": self.state_file + ".clock",
            "AGENT_BOT_ID": str(BOT),
        }

    def _gh(self, args: list[str], stdin: str | None = None) -> str:
        p = subprocess.run([os.path.join(FAKE_BIN, "gh"), *args], input=stdin, capture_output=True, text=True, env=self.env(), check=False)
        if p.returncode != 0:
            raise GhError(p.stderr.strip() or f"fake gh exited with {p.returncode}")
        return p.stdout

    def _load(self) -> dict[str, Any]:
        with open(self.state_file, encoding="utf-8") as f:
            return dict(json.load(f))

    def _save(self, st: dict[str, Any]) -> None:
        with open(self.state_file, "w", encoding="utf-8") as f:
            json.dump(st, f)

    @contextmanager
    def _edit(self) -> Iterator[dict[str, Any]]:
        st = self._load()
        yield st
        self._save(st)

    @staticmethod
    def _tick(st: dict[str, Any]) -> str:
        st["clock"] = st.get("clock", 0) + 1
        t = st["clock"]
        return f"2020-01-01T{t // 3600 % 24:02d}:{t // 60 % 60:02d}:{t % 60:02d}Z"

    # --- building the repository -----------------------------------------------------------------
    def add_issue(
        self, number: int, *, labels: tuple[str, ...] = (), author: int = HUMAN, body: str = "", state: str = "open", reason: str | None = None, title: str = ""
    ) -> int:
        with self._edit() as st:
            st["items"][str(number)] = {
                "kind": "issue",
                "labels": [],
                "comments": [],
                "state": "OPEN" if state == "open" else "CLOSED",
                "state_reason": reason,
                "head": None,
                "author": author,
                "body": body,
                "title": title or f"T{number}",
            }
            self._label(st, number, labels)
        return number

    def add_pr(
        self,
        number: int,
        *,
        head: str | None = None,
        labels: tuple[str, ...] = (),
        state: str = "OPEN",
        draft: bool = False,
        head_ref: str = "",
        mergeable: tuple[str, ...] = ("MERGEABLE",),
        files: tuple[str, ...] = (),
        issue: int | None = None,
    ) -> int:
        head = head or sha(0x10000 + number)
        with self._edit() as st:
            st["shas"].setdefault(
                head,
                {"base_version": 0, "commit": {}, "files": [{"filename": f, "status": "modified", "changes": 1, "patch": "@@ -1 +1 @@\n+x"} for f in files]},
            )
            st["items"][str(number)] = {
                "kind": "pr",
                "labels": [],
                "comments": [],
                "state": state,
                "head": head,
                "draft": draft,
                "branch": head_ref or f"agent/issue-{number}",
                "mergeable_plan": list(mergeable),
                "issue": issue,
            }
            self._label(st, number, labels)
        return number

    def _label(self, st: dict[str, Any], number: int, labels: tuple[str, ...]) -> None:
        it = st["items"][str(number)]
        for label in labels:
            it["labels"].append(label)
            it.setdefault("label_at", {})[label] = self._tick(st)
            st["events"].append(["labeled", str(number), label])

    def say(self, number: int, body: str, author: int = BOT) -> None:
        """A comment by anyone (the API only lets the tests comment as the bot)."""
        with self._edit() as st:
            c = {"id": len(st["comments_all"]) + 1, "body": body, "user": {"id": author}, "created_at": self._tick(st)}
            st["comments_all"].append(c)
            st["items"][str(number)]["comments"].append(c["id"])

    def close(self, number: int, reason: str | None = "completed") -> None:
        """Closes an issue with a REST state_reason (completed, not_planned, duplicate or None)."""
        with self._edit() as st:
            st["items"][str(number)].update(state="CLOSED", state_reason=reason)

    def set_head(self, number: int, head: str) -> None:
        with self._edit() as st:
            st["shas"].setdefault(head, {"base_version": 0, "commit": {}, "files": []})
            st["items"][str(number)]["head"] = head

    def diff(self, head: str, changes: list[FileChange]) -> None:
        """A commit whose own changes (base...head) are these."""
        with self._edit() as st:
            st["shas"].setdefault(head, {"base_version": 0, "commit": {}})["files"] = [
                {
                    k: v
                    for k, v in {
                        "filename": c.filename,
                        "status": c.status,
                        "patch": c.patch,
                        "previous_filename": c.previous_filename,
                        "changes": c.changes,
                    }.items()
                    if v is not None
                }
                for c in changes
            ]

    def commit_is(self, c: Commit) -> None:
        with self._edit() as st:
            st["shas"].setdefault(c.sha, {"base_version": 0, "files": []})["commit"] = {
                "parents": [{"sha": p} for p in c.parents],
                "author": {"id": c.author_id} if c.author_id is not None else None,
                "committer": {"login": c.committer_login},
                "commit": {"verification": {"verified": c.verified}},
            }

    def compare_is(self, merged_in: str, status: str) -> None:
        """What comparing a commit with the base branch says (default: ahead, i.e. it's on the base)."""
        with self._edit() as st:
            st.setdefault("compare_status", {})[merged_in] = status

    def run_active(self, workflow: str, status: str, title: str) -> None:
        with self._edit() as st:
            st.setdefault("active_runs", []).append({"workflow": workflow, "status": status, "name": "Agent · x", "displayTitle": title})

    def fail(self, *calls: str) -> None:
        """The next `gh` call containing each of these fails once (e.g. "issues/7/labels")."""
        with self._edit() as st:
            st.setdefault("fail_cmds", []).extend(calls)

    # --- reading it back ---------------------------------------------------------------------------
    def _item(self, number: int) -> dict[str, Any]:
        return dict(self._load()["items"][str(number)])

    def all_labels(self, number: int) -> list[str]:
        return list(self._item(number)["labels"])

    def agent_labels(self, number: int) -> list[str]:
        return [label for label in self.all_labels(number) if label.startswith("agent:")]

    def bodies(self, number: int) -> list[str]:
        st = self._load()
        ids = set(st["items"][str(number)]["comments"])
        return [c["body"] for c in st["comments_all"] if c["id"] in ids]

    def labeled(self, number: int) -> list[str]:
        """Every label applied to the item, in order (each one fired a `labeled` event)."""
        return [e[2] for e in self._load()["events"] if e[0] == "labeled" and e[1] == str(number)]

    def body(self, number: int) -> str:
        return str(self._item(number).get("body", ""))

    def issue_state(self, number: int) -> tuple[str, str | None]:
        it = self._item(number)
        return it["state"], it.get("state_reason")

    def assignees(self, number: int) -> list[str]:
        return list(self._item(number).get("assignees", []))

    def sub_issues(self, number: int) -> list[int]:
        return list(self._item(number).get("sub_issues", []))

    def numbers(self) -> list[int]:
        return sorted(int(n) for n in self._load()["items"])


class FakeClock:
    """Time that only moves when told to, and sleeps that only get recorded."""

    def __init__(self, now: float = 1_800_000_000) -> None:
        self._now = now
        self.slept: list[float] = []

    def now(self) -> float:
        return self._now

    def sleep(self, seconds: float) -> None:
        self.slept.append(seconds)
        self._now += seconds
