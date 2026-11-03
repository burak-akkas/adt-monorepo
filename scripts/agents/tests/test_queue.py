"""The merge queue's order, tidying it, and sending PRs that conflict after a merge back."""

import unittest

from agentflow import queue
from tests.support import HUMAN, FakeClock, Repo
from tests.test_states import settings

S = settings()
A = "a" * 40


class QueueTest(unittest.TestCase):
    def test_integrating_first_then_by_admission(self) -> None:
        gh = Repo()
        gh.add_pr(105, head=A, labels=("agent:queued",))
        gh.add_pr(104, head=A, labels=("agent:queued",))
        gh.add_pr(106, head=A, labels=("agent:integrating",))
        gh.add_pr(107, head=A, labels=("agent:review",))
        gh.add_pr(108, head=A, labels=("agent:queued",), draft=True)
        gh.add_pr(109, head=A, labels=("agent:queued",))  # labeled by hand, no admission: last
        gh.add_pr(110, head=A, labels=("agent:queued",))
        for n in (105, 104, 106):
            gh.say(n, "<!-- agent:queued -->\n🚦 Queued")
        gh.say(110, "<!-- agent:queued -->", author=HUMAN)
        self.assertEqual(queue.order(gh, S), [(106, "integrating"), (105, "queued"), (104, "queued"), (109, "queued"), (110, "queued")])

    def test_a_pr_in_both_states_is_listed_once(self) -> None:
        gh = Repo()
        gh.add_pr(101, head=A, labels=("agent:integrating", "agent:queued"))
        self.assertEqual(queue.order(gh, S), [(101, "integrating")])


class TidyTest(unittest.TestCase):
    def test_merged_and_closed_prs_leave_the_queue(self) -> None:
        gh = Repo()
        gh.add_pr(101, head=A, labels=("agent:queued",), state="MERGED")
        gh.add_pr(102, head=A, labels=("agent:approved",), state="CLOSED")
        gh.add_pr(103, head=A, labels=("agent:queued",))
        self.assertEqual(queue.tidy(gh, S), ["#101 is merged: agent:queued -> agent:done", "#102 is closed: removed agent:approved"])
        self.assertEqual((gh.agent_labels(101), gh.agent_labels(102), gh.agent_labels(103)), (["agent:done"], [], ["agent:queued"]))

    def test_never_fails(self) -> None:
        gh = Repo()
        gh.add_pr(101, head=A, labels=("agent:queued",), state="MERGED")
        gh.fail("--label agent:queued")
        self.assertEqual(queue.tidy(gh, S), [])  # that listing failed: the others still ran
        gh.fail("issues/101/labels")
        self.assertEqual(queue.tidy(gh, S), [])  # the transition failed: nothing reported
        self.assertEqual(queue.tidy(gh, S), ["#101 is merged: agent:queued -> agent:done"])  # and the next run catches up


class SweepConflictsTest(unittest.TestCase):
    def test_sends_conflicting_agent_prs_back(self) -> None:
        gh = Repo()
        gh.add_pr(101, head=A, labels=("agent:queued",), mergeable=("UNKNOWN", "CONFLICTING"), issue=11)
        gh.add_issue(11)
        gh.add_pr(102, head=A, mergeable=("MERGEABLE",))
        gh.add_pr(103, head=A, mergeable=("CONFLICTING",), head_ref="human/tweak")
        gh.add_pr(104, head=A, labels=("agent:fixing",), mergeable=("CONFLICTING",))
        gh.add_pr(105, head=A, mergeable=("CONFLICTING",))
        gh.run_active("agent-implementor.yml", "in_progress", "T105")
        clock = FakeClock()
        out = queue.sweep_conflicts(gh, S, 100, "main", clock=clock)
        self.assertEqual(
            out,
            ["PR #101: CONFLICTING", "PR #102: MERGEABLE", "PR #104: CONFLICTING", "PR #105: CONFLICTING", "PR #105: the Implementor is already working on it"],
        )
        self.assertEqual(clock.slept, [20, 10])
        self.assertEqual(gh.agent_labels(101), ["agent:changes-requested"])
        self.assertIn("#100 was just merged into `main`, and this PR now **conflicts** with it. It leaves the merge queue", gh.bodies(101)[0])
        self.assertIn("conflicts with the just-merged #100", gh.bodies(11)[0])
        self.assertEqual((gh.agent_labels(104), gh.agent_labels(105)), (["agent:fixing"], []))

    def test_never_fails(self) -> None:
        gh = Repo()
        gh.add_pr(101, head=A, mergeable=("CONFLICTING",))
        gh.fail("--json mergeable")
        self.assertEqual(queue.sweep_conflicts(gh, S, 100, "main", clock=FakeClock()), [])
        gh.fail("pr list")
        self.assertEqual(queue.sweep_conflicts(gh, S, 100, "main", clock=FakeClock()), [])


if __name__ == "__main__":
    unittest.main()
