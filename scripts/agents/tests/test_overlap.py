"""Conflict avoidance: which in-flight work changes the same files, and starting waiting issues."""

import json
import unittest

from agentflow import overlap
from agentflow.github import GhError
from tests.support import HUMAN, FakeClock, Repo
from tests.test_states import settings

S = settings()
A = "a" * 40


def plan(gh: Repo, n: int, files: list[str], author: int | None = None) -> None:
    gh.say(n, f"<!-- agent:files {json.dumps(files)} -->\n📁 Planned files", **({"author": author} if author else {}))


def in_flight() -> Repo:
    gh = Repo()
    gh.add_pr(101, files=("src/a.ts",))
    gh.add_pr(102, files=("src/a.ts",), labels=("agent:needs-human",))
    gh.add_pr(103, files=("src/a.ts",), draft=True)
    gh.add_pr(104, files=("src/a.ts",), head_ref="agent/issue-201")  # the issue's own PR
    gh.add_pr(105, files=("package-lock.json",))
    gh.add_pr(106, files=("src/a.ts",), head_ref="human/tweak")
    gh.add_issue(202, labels=("agent:ready",))
    plan(gh, 202, ["src/b.ts"])
    gh.add_issue(203, labels=("agent:in-progress",))
    plan(gh, 203, ["src/a.ts", "src/c.ts"])
    gh.add_issue(204, labels=("agent:analyzed",))
    plan(gh, 204, ["src/a.ts"])  # not started: doesn't count
    return gh


class OverlapTest(unittest.TestCase):
    def test_finds_in_flight_work_on_the_same_files(self) -> None:
        gh = in_flight()
        gh.add_issue(201, labels=("agent:analyzed",))
        plan(gh, 201, ["src/a.ts", "package-lock.json", "src/new.ts", "src/c.ts"])
        self.assertEqual(overlap.blockers(gh, S, 201), [(101, ["src/a.ts"]), (203, ["src/a.ts", "src/c.ts"])])

    def test_the_latest_bot_plan_counts(self) -> None:
        gh = in_flight()
        gh.add_issue(201, labels=("agent:analyzed",))
        plan(gh, 201, ["src/a.ts"])
        plan(gh, 201, ["src/z.ts"])
        plan(gh, 201, ["src/a.ts"], author=HUMAN)
        self.assertEqual(overlap.blockers(gh, S, 201), [])

    def test_ignored_files_and_no_plan(self) -> None:
        gh = in_flight()
        gh.add_issue(201)
        self.assertEqual(overlap.blockers(gh, S, 201), [])
        plan(gh, 201, ["src/a.ts"])
        self.assertEqual(overlap.blockers(gh, S, 201, ignore="src/*"), [])

    def test_an_error_is_never_no_overlap(self) -> None:
        gh = in_flight()
        gh.add_issue(201)
        plan(gh, 201, ["src/a.ts"])
        gh.fail("pulls/101/files")
        with self.assertRaises(GhError):
            overlap.blockers(gh, S, 201)


class ReleaseWaitingTest(unittest.TestCase):
    def test_starts_one_by_one_when_the_overlap_is_gone(self) -> None:
        gh = Repo()
        gh.add_pr(101, files=("src/a.ts",), state="MERGED")
        for n, files in ((201, ["src/a.ts"]), (202, ["src/a.ts", "src/b.ts"]), (203, ["src/z.ts"])):
            gh.add_issue(n, labels=("agent:waiting",))
            plan(gh, n, files)
        clock = FakeClock(now=0)  # the fake's label events are at the start of 2020
        out = overlap.release_waiting(gh, S, max_minutes=10**9, clock=clock)
        self.assertEqual((gh.agent_labels(201), gh.agent_labels(202), gh.agent_labels(203)), (["agent:ready"], ["agent:waiting"], ["agent:ready"]))
        self.assertIn("#201 released: nothing in flight touches its planned files any more", out)
        self.assertTrue(any(line.startswith("#202 still waits (") and line.endswith("m): #201") for line in out), out)
        out = overlap.release_waiting(gh, S, max_minutes=1, clock=FakeClock(now=1577836800 + 3600))
        self.assertEqual(gh.agent_labels(202), ["agent:ready"])
        b = next(b for b in gh.bodies(202) if "Conflict avoidance:" in b)
        self.assertIn("so it starts anyway. Expect conflicts with #201. Starting", b)

    def test_a_failed_check_keeps_waiting(self) -> None:
        gh = Repo()
        gh.add_pr(101, files=("src/a.ts",))
        gh.add_issue(201, labels=("agent:waiting",))
        plan(gh, 201, ["src/a.ts"])
        gh.fail("pulls/101/files")
        self.assertEqual(overlap.release_waiting(gh, S, max_minutes=10**9, clock=FakeClock()), ["#201: couldn't check the overlap, trying again later"])
        self.assertEqual(gh.agent_labels(201), ["agent:waiting"])


if __name__ == "__main__":
    unittest.main()
