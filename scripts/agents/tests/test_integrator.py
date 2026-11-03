"""The Integrator's work on one queued PR, on the simulator's fake gh (which audits every merge)."""

import unittest
from typing import Any

from agentflow.integrator import Config, integrate
from tests.support import FakeClock, Repo, sha
from tests.test_states import settings

S = settings()


def approval(head: str) -> str:
    return f"<!-- agent:reviewer -->\n**Verdict:** approve\n<!-- agent:approved-sha {head} -->"


class Queue:
    """PR #101 for issue #11, approved at its head and admitted to the queue."""

    def __init__(self, labels: tuple[str, ...] = ("agent:queued",), files: tuple[str, ...] = ("src/a.ts",), **pr: Any) -> None:
        self.gh = Repo()
        self.gh.add_issue(11, labels=("agent:pr-open",))
        self.gh.add_pr(101, labels=labels, files=files, issue=11, **pr)
        self.head = self.gh.head(101)
        self.gh.say(101, approval(self.head))
        self.gh.say(101, "<!-- agent:queued -->\n🚦 Queued")
        self.log: list[str] = []
        self.clock = FakeClock()

    def run(self, **cfg: Any) -> str:
        return integrate(self.gh, S, 101, Config(**cfg), clock=self.clock, log=self.log.append)

    def last(self) -> str:
        return self.gh.bodies(101)[-1]


class MergeTest(unittest.TestCase):
    def test_an_approved_green_up_to_date_pr_merges(self) -> None:
        q = Queue()
        self.assertEqual(q.run(), "merged")
        self.assertEqual(q.gh.merged(), [101])
        self.assertEqual((q.gh.agent_labels(101), q.gh.agent_labels(11)), (["agent:done"], ["agent:done"]))
        self.assertIn("✅ **Merged** #101", q.gh.bodies(11)[-1])
        self.assertEqual(q.gh.violations(), [])

    def test_behind_the_base_it_updates_records_the_update_as_approved_and_merges(self) -> None:
        q = Queue()
        q.gh.base_moves(2)
        self.assertEqual(q.run(), "merged")
        new = q.gh.head(101)
        self.assertNotEqual(new, q.head)
        update = next(b for b in q.gh.bodies(101) if "<!-- agent:integrator -->" in b)
        self.assertIn("merged `main` (2 new commit(s)) into #101. Its own changes are unchanged", update)
        self.assertIn(f"<!-- agent:approved-sha {new} -->", update)
        self.assertEqual(q.gh.violations(), [])

    def test_a_clean_update_made_earlier_is_accepted_as_approved(self) -> None:
        q = Queue()
        q.gh.base_moves()
        q.gh.update_branch(101, q.head)  # GitHub's own merge of the base on the approved commit
        self.assertEqual(q.run(), "merged")
        self.assertTrue(any("is GitHub's clean merge of `main` into the approved" in b for b in q.gh.bodies(101)))

    def test_gh_reporting_an_error_after_the_merge_still_counts_as_merged(self) -> None:
        q = Queue()
        q.gh.set(101, merge_error_after=True)
        self.assertEqual(q.run(), "merged")
        self.assertEqual(q.gh.agent_labels(101), ["agent:done"])


class LeavesTheQueueTest(unittest.TestCase):
    def test_not_queued_closed_or_merged(self) -> None:
        q = Queue(labels=("agent:review",))
        self.assertEqual(q.run(), "left")
        q = Queue(state="CLOSED")
        self.assertEqual(q.run(), "left")
        q = Queue(state="MERGED")
        self.assertEqual(q.run(), "left")
        self.assertEqual(q.gh.agent_labels(101), ["agent:done"])

    def test_a_draft_leaves(self) -> None:
        q = Queue(draft=True)
        self.assertEqual(q.run(), "left")
        self.assertEqual(q.gh.agent_labels(101), [])
        self.assertIn("is a draft now, so it leaves the queue", q.last())

    def test_new_commits_after_the_approval_go_back_to_review(self) -> None:
        q = Queue()
        q.gh.set_head(101, sha(0xBEEF))
        self.assertEqual(q.run(), "left")
        self.assertEqual(q.gh.agent_labels(101), ["agent:review"])
        self.assertIn(f"the agents approved `{q.head[:7]}`, but the head is now `{sha(0xBEEF)[:7]}`", q.last())

    def test_without_an_approval(self) -> None:
        gh = Repo()
        gh.add_pr(101, labels=("agent:queued",))
        self.assertEqual(integrate(gh, S, 101, Config(), clock=FakeClock(), log=lambda _: None), "left")
        self.assertIn("no recorded approval for", gh.bodies(101)[-1])

    def test_github_refusing_the_update_needs_a_human(self) -> None:
        q = Queue()
        q.gh.base_changes_workflows()
        self.assertEqual(q.run(), "left")
        self.assertEqual(q.gh.agent_labels(101), ["agent:needs-human"])
        self.assertIn("GitHub refused to merge `main` into #101 although they don't conflict", q.last())
        self.assertEqual(q.clock.slept[:1], [10])  # one retry first

    def test_qa_that_does_not_finish_frees_the_queue(self) -> None:
        q = Queue()
        self.assertEqual(q.run(qa_in_queue=True, qa_minutes=2), "left")
        self.assertEqual(q.gh.agent_labels(101), ["agent:qa"])
        self.assertIn("QA didn't finish within 2 minutes", q.last())


class HumanMergesTest(unittest.TestCase):
    """High-risk PRs and PRs that change the team's own tooling go through the queue like any other (update,
    checks, QA), and the Integrator hands them to a human at the point where it would merge."""

    def handed(self, q: Queue, head: str) -> str:
        self.assertEqual(q.gh.merged(), [])
        self.assertEqual(q.gh.agent_labels(101), ["agent:needs-human"])
        self.assertEqual(q.gh.violations(), [])  # the fake audits the handoff like a merge
        with q.gh._edit() as st:
            self.assertEqual([a["sha"] for a in st["handoff_audit"]], [head])
        body = next(b for b in reversed(q.gh.bodies(101)) if "agent:ready-to-merge" in b)
        self.assertIn(f"<!-- agent:ready-to-merge {head} -->", body)
        return body

    def test_a_high_risk_pr_is_handed_over_green_and_up_to_date(self) -> None:
        q = Queue()
        q.gh.add_label(11, "risk:high")
        q.gh.base_moves()
        self.assertEqual(q.run(), "handed")
        new = q.gh.head(101)
        self.assertNotEqual(new, q.head)  # brought up to date first
        body = self.handed(q, new)
        self.assertIn("#11 is **high risk**", body)
        self.assertIn(f"Merge exactly `{new[:7]}`", body)
        self.assertIn("apply `agent:approved`", body)
        self.assertIn("ready for a human to merge", q.gh.bodies(11)[-1])
        self.assertEqual(q.gh.agent_labels(11), ["agent:pr-open"])  # the issue closes when the human merges

    def test_qa_tests_it_before_the_handover(self) -> None:
        q = Queue()
        q.gh.add_label(11, "risk:high")
        self.assertEqual(q.run(qa_in_queue=True, qa_minutes=2), "left")
        self.assertEqual(q.gh.agent_labels(101), ["agent:qa"])  # the queue held for QA, as for any PR
        q = Queue()
        q.gh.add_label(11, "risk:high")
        q.gh.say(101, f"<!-- agent:qa -->\n**Verdict:** pass\n<!-- agent:approved-sha {q.head} -->")
        self.assertEqual(q.run(qa_in_queue=True), "handed")
        self.assertIn("QA passed", self.handed(q, q.head))

    def test_red_checks_go_to_the_implementor_not_to_the_human(self) -> None:
        q = Queue()
        q.gh.add_label(11, "risk:high")
        q.gh.checks("fail")
        self.assertEqual(q.run(), "bounced")
        self.assertEqual(q.gh.agent_labels(101), ["agent:changes-requested"])

    def test_risk_raised_while_it_is_tested_is_handed_over(self) -> None:
        q = Queue()
        with q.gh._edit() as st:
            st["hooks"] = [{"match": "pr checks 101", "pr": 11, "labels": ["agent:pr-open", "risk:high"]}]
        self.assertEqual(q.run(), "handed")
        self.handed(q, q.head)

    def test_protected_paths_are_handed_over_with_the_list(self) -> None:
        q = Queue(files=(".github/workflows/ci.yml", "src/a.ts", "scripts/x.sh"))
        self.assertEqual(q.run(), "handed")
        self.assertIn("changes the agent team's own tooling:\n- `.github/workflows/ci.yml`\n- `scripts/x.sh`", self.handed(q, q.head))

    def test_the_fake_flags_a_handover_of_an_untested_commit(self) -> None:
        q = Queue()
        q.gh.checks("fail")
        q.gh.comment(101, f"<!-- agent:ready-to-merge {q.head} -->")  # through gh, as the Integrator posts it
        self.assertEqual([v["kind"] for v in q.gh.violations()], ["unsafe-handoff"])

    def test_allowed_explicitly_it_merges(self) -> None:
        q = Queue()
        q.gh.add_label(11, "risk:high")
        self.assertEqual(q.run(high_risk_ok=True), "merged")


class FailuresTest(unittest.TestCase):
    def test_a_conflict_goes_to_the_implementor_and_is_no_failed_attempt(self) -> None:
        q = Queue(conflict=True)
        self.assertEqual(q.run(), "bounced")
        self.assertEqual(q.gh.agent_labels(101), ["agent:changes-requested"])
        self.assertIn("**Merge queue:** #101 conflicts with `main`, so #101 leaves the queue", q.last())
        self.assertNotIn("integration-failed", q.last())

    def test_red_checks_bounce_and_count(self) -> None:
        q = Queue()
        q.gh.checks("fail")
        self.assertEqual(q.run(), "bounced")
        self.assertIn("<!-- agent:integration-failed -->", q.last())
        self.assertIn("required checks failed on", q.last())
        self.assertIn("(failed attempt 1 of 3)", q.last())

    def test_checks_that_never_finish_send_it_to_the_back(self) -> None:
        q = Queue()
        q.gh.checks("hang")
        self.assertEqual(q.run(checks_minutes=3), "requeued")
        self.assertEqual(q.gh.agent_labels(101), ["agent:queued"])
        self.assertTrue(q.last().startswith("<!-- agent:queued -->\n<!-- agent:integration-failed -->\n⏳ **Merge queue:** the required checks (CI)"))

    def test_a_required_check_that_never_reports_needs_a_human(self) -> None:
        q = Queue()
        q.gh.checks("none")
        self.assertEqual(q.run(checks_minutes=3), "left")
        self.assertEqual(q.gh.agent_labels(101), ["agent:needs-human"])
        self.assertIn("none of the required checks (`AGENT_REQUIRED_CHECKS` = `CI`)", q.last())

    def test_a_failed_merge_goes_to_the_back(self) -> None:
        q = Queue(merge_fails=1)
        self.assertEqual(q.run(), "requeued")
        self.assertIn("the merge failed: GraphQL: Base branch was modified", q.last())

    def test_the_third_failed_attempt_goes_to_the_lead_and_a_lead_decision_resets_the_count(self) -> None:
        q = Queue()
        q.gh.checks("fail")
        for _ in range(2):
            q.gh.say(101, "<!-- agent:integration-failed -->\nearlier")
        self.assertEqual(q.run(), "lead")
        self.assertEqual(q.gh.agent_labels(101), ["agent:needs-decision"])
        self.assertIn("That's 3 failed merge attempts since the last Lead decision", q.last())
        q.gh.say(101, "<!-- agent:lead -->\n**Decision:** fix")
        q.gh.add_label(101, "agent:queued")
        self.assertEqual(q.run(), "bounced")

    def test_an_unexpected_error_sends_it_to_the_back_instead_of_leaving_it_stuck(self) -> None:
        q = Queue()
        q.gh.fail("compare/")
        self.assertEqual(q.run(), "requeued")
        self.assertIn("the Integrator hit an unexpected error", q.last())
        self.assertEqual(q.gh.agent_labels(101), ["agent:queued"])

    def test_a_pr_merged_meanwhile_is_done_not_failed(self) -> None:
        q = Queue()
        q.gh.checks("fail")
        q.gh.set(101, state="MERGED")
        self.assertEqual(q.run(), "left")  # merged before the run looked: nothing to do


class QaInTheQueueTest(unittest.TestCase):
    def test_qa_tests_the_front_of_the_queue_once_then_it_merges(self) -> None:
        q = Queue()
        # The merge gate hands the PR back as agent:integrating once QA passed (another run, right then).
        q.gh.set(101)
        with q.gh._edit() as st:
            st["hooks"] = [{"match": "pr view 101", "pr": 101, "if_label": "agent:qa", "labels": ["agent:integrating"], "approve_head": True}]
        self.assertEqual(q.run(qa_in_queue=True), "merged")
        hold = next(b for b in q.gh.bodies(101) if "<!-- agent:integrator-hold" in b)
        self.assertIn(f"QA tests `{q.head[:7]}` now, and the queue waits for its verdict", hold)

    def test_qa_already_passed_or_paths_qa_does_not_cover(self) -> None:
        q = Queue()
        q.gh.say(101, f"<!-- agent:qa -->\n**Verdict:** pass\n<!-- agent:approved-sha {q.head} -->")
        self.assertEqual(q.run(qa_in_queue=True), "merged")
        q = Queue(files=("api/x.py",))
        self.assertEqual(q.run(qa_in_queue=True, qa_paths="web/"), "merged")
        self.assertFalse(any("integrator-hold" in b for b in q.gh.bodies(101)))


class ConfigTest(unittest.TestCase):
    def test_from_the_environment(self) -> None:
        warnings: list[str] = []
        c = Config.from_env(
            {
                "AGENT_REQUIRED_CHECKS": "Web@web/",
                "AGENT_QA_IN_QUEUE": "true",
                "AGENT_MERGE_METHOD": "octopus",
                "AGENT_PROTECTED_PATHS": ".github/, infra/",
                "AGENT_INTEGRATOR_MAX_ATTEMPTS": "5",
            },
            warn=warnings.append,
        )
        self.assertEqual((c.required, c.qa_in_queue, c.method, c.protected, c.max_attempts), ("Web@web/", True, "squash", (".github/", "infra/"), 5))
        self.assertIn("AGENT_MERGE_METHOD must be squash, merge or rebase", warnings[0])
        d = Config.from_env({})
        self.assertEqual((d.required, d.qa_in_queue, d.method, d.checks_minutes, d.qa_minutes), ("CI", False, "squash", 30, 60))


if __name__ == "__main__":
    unittest.main()


class RaceTest(unittest.TestCase):
    def test_a_pr_taken_out_of_the_queue_while_its_checks_ran_is_not_merged(self) -> None:
        q = Queue()
        # Another run takes the PR out of the queue while the Integrator waits for the checks.
        with q.gh._edit() as st:
            st["hooks"] = [{"match": "pr checks 101", "pr": 101, "labels": ["agent:review"]}]
        self.assertEqual(q.run(), "left")
        self.assertEqual(q.gh.merged(), [])
