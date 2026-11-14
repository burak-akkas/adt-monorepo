"""What the workflow steps share, and the pieces of their logic worth testing on their own."""

import json
import os
import tempfile
import unittest

from agentflow import prs, qa_run, review, roles, step
from agentflow.model import Check, FileChange
from tests.support import BOT, HUMAN, Repo
from tests.test_states import settings

S = settings()


def read(path: str) -> str:
    with open(path, encoding="utf-8") as f:
        return f.read()


class StepIOTest(unittest.TestCase):
    def test_writes_outputs_summary_and_log(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            out, summary, log = os.path.join(d, "out"), os.path.join(d, "summary"), os.path.join(d, "log")
            with open(log, "w") as stream:
                io = step.FileStepIO({"GITHUB_OUTPUT": out, "GITHUB_STEP_SUMMARY": summary}, stream)
                io.output(stop="true", round=2)
                io.tell("Skipped review: x")
                io.warn("careful")
            self.assertEqual(read(out), "stop=true\nround=2\n")
            self.assertEqual(read(summary), "Skipped review: x\n")
            self.assertEqual(read(log), "Skipped review: x\n::warning::careful\n")
            self.assertEqual(io.outputs, {"stop": "true", "round": "2"})

    def test_the_agents_result(self) -> None:
        self.assertEqual(step.result('{"decision": "ready"}'), {"decision": "ready"})
        for raw in ("", "null", "not json", "[1]"):
            self.assertEqual(step.result(raw), {})
        self.assertEqual(step.field_of({"verdict": None}, "verdict", "error"), "error")
        self.assertEqual(step.field_of({"verdict": False}, "verdict", "error"), "error")
        self.assertEqual(step.field_of({"verdict": "pass"}, "verdict", "error"), "pass")

    def test_denied_tools(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "run.json")
            with open(path, "w") as f:
                json.dump([{"type": "result", "permission_denials": [{"tool_name": "Bash", "tool_input": {"command": "x" * 400}}]}], f)
            io = step.StepIO()
            step.denied_tools(path, io)
            self.assertEqual(io.summary[0], "### Denied tool calls")
            self.assertEqual(len(io.summary[1]), len("- `Bash`: ``") + 300)
            self.assertEqual(io.log[-1], "::warning::Agent had denied tool calls, see the job summary")
            quiet = step.StepIO()
            step.denied_tools(os.path.join(d, "missing.json"), quiet)
            self.assertEqual((quiet.log, quiet.summary), ([], []))


class RoundsTest(unittest.TestCase):
    def test_only_unsuccessful_rounds_since_the_lead_count(self) -> None:
        gh = Repo()
        gh.add_pr(101)
        for body in ("**Verdict:** request-changes", "**Verdict:** approve", "**Verdict:** request-changes"):
            gh.say(101, f"<!-- agent:reviewer -->\n{body}")
        gh.say(101, "<!-- agent:reviewer -->\n**Verdict:** request-changes", author=HUMAN)
        self.assertEqual(review.rounds(gh, S, 101, "reviewer", review.APPROVE), (3, 3, 2))
        gh.say(101, "<!-- agent:lead -->")
        gh.say(101, "<!-- agent:reviewer -->\n**Verdict:** request-changes")
        self.assertEqual(review.rounds(gh, S, 101, "reviewer", review.APPROVE), (4, 1, 1))


class ChecksTest(unittest.TestCase):
    def test_only_required_workflows_count(self) -> None:
        def c(workflow: str, bucket: str) -> Check:
            return Check(workflow, workflow.lower(), bucket, f"https://ci/{workflow}")

        self.assertEqual(prs.evaluate_checks([c("CI", "pass"), c("Lint", "fail")], "CI"), ("pass", ""))
        self.assertEqual(prs.evaluate_checks([c("CI", "pass"), c("Web", "cancel")], "CI, Web"), ("fail", "[web](https://ci/Web)"))
        self.assertEqual(prs.evaluate_checks([c("CI", "pending")], "CI"), ("pending", ""))
        self.assertEqual(prs.evaluate_checks([c("Lint", "pass")], "CI"), ("none", ""))


class MergeGateTest(unittest.TestCase):
    def test_high_risk_and_protected_prs_join_the_queue_too(self) -> None:
        # The Integrator tests them like any other (update, checks, QA) and hands them to a human to merge.
        for issue_labels, files in ((("agent:pr-open", "risk:high"), ("src/a.ts",)), (("agent:pr-open",), ("scripts/x.sh",))):
            gh = Repo()
            gh.add_issue(11, labels=issue_labels)
            gh.add_pr(101, labels=("agent:approved",), files=files, issue=11)
            head = gh.head(101)
            gh.say(101, f"<!-- agent:reviewer -->\n**Verdict:** approve\n<!-- agent:approved-sha {head} -->")
            io = step.StepIO()
            review.merge_risk_gate(gh, S, io, 101, head=head, by=review.Approval("Bot", "bot"))
            self.assertNotIn("stop", io.outputs)
            self.assertEqual(gh.agent_labels(101), ["agent:approved"])
            self.assertTrue(any("a human merges it once the queue has tested it" in line for line in io.log + io.summary), io.log + io.summary)


class DesignTest(unittest.TestCase):
    def test_planned_files(self) -> None:
        self.assertEqual(roles.planned({"files": ["./b.ts", "a.ts", "", 3, "a.ts"]}), ["a.ts", "b.ts"])
        self.assertEqual(roles.planned({}), [])

    def test_the_analyst_without_its_comment_goes_to_the_lead(self) -> None:
        gh = Repo()
        gh.add_issue(7, labels=("agent:start",))
        io = step.StepIO()
        roles.analyst_apply(gh, S, io, 7, raw='{"decision": "analyzed"}', before=0, autonomy="")
        self.assertEqual(gh.agent_labels(7), ["agent:needs-decision"])
        self.assertIn("::warning::analyst returned 'analyzed' but posted no handoff comment", io.log)
        gh.say(7, "<!-- agent:analyst -->", author=BOT)
        roles.analyst_apply(gh, S, step.StepIO(), 7, raw='{"decision": "needs-info"}', before=0, autonomy="full")
        self.assertEqual(gh.agent_labels(7), ["agent:needs-decision"])


class ScreenshotsTest(unittest.TestCase):
    def test_order_and_captions(self) -> None:
        cwd = os.getcwd()
        with tempfile.TemporaryDirectory() as d:
            os.chdir(d)
            try:
                os.makedirs(".agent-out/screenshots")
                for name in ("b.png", "a.png", "c.jpg", "d.jpeg"):
                    open(os.path.join(".agent-out/screenshots", name), "w").close()
                self.assertEqual([os.path.basename(f) for f in qa_run.screenshots()], ["a.png", "b.png", "d.jpeg", "c.jpg"])
                gh = Repo()
                gh.add_pr(101)
                raw = json.dumps({"screenshots": [{"file": "shots/a.png", "caption": "The board"}]})
                qa_run.link_screenshots(step.StepIO(), gh, pr=101, raw=raw, round_="2", link="https://artifact")
                body = gh.bodies(101)[0]
                self.assertIn("4 screenshots are in the [run artifact](https://artifact)", body)
                self.assertIn("- `a.png`: The board\n- `b.png`: b.png\n", body)
            finally:
                os.chdir(cwd)


class ReviewLoopTest(unittest.TestCase):
    """Stable blocking IDs: each round's commit and IDs are recorded, and a returning ID goes to the Lead."""

    def setUp(self) -> None:
        self.gh = Repo()
        self.gh.add_issue(11, labels=("agent:pr-open",))
        self.gh.add_pr(101, labels=("agent:review",), files=("apps/web/src/a.ts",), issue=11)
        self.head = self.gh.head(101)

    def review(self, verdict: str, blocking: list[str], head: str | None = None, text: str = "") -> step.StepIO:
        head = head or self.head
        self.gh.set_head(101, head)
        self.gh.set(101, labels=["agent:review"])
        before = len([b for b in self.gh.bodies(101) if "<!-- agent:reviewer -->" in b])
        self.gh.say(101, f"<!-- agent:reviewer -->\n**Verdict:** {verdict}{text}")
        io = step.StepIO()
        raw = json.dumps({"verdict": verdict, "blocking": blocking})
        review.reviewer_apply(self.gh, S, io, 101, head=head, raw=raw, total=before, round_=before + 1, qa=review.QaRules())
        return io

    def test_records_the_commit_and_ids_on_the_reviewers_comment(self) -> None:
        self.review("request-changes", ["B1", "B2", "B1", "nope"])
        self.assertIn(f"<!-- agent:reviewed {self.head} blocking=B1,B2 -->", self.gh.bodies(101)[-1])
        self.assertEqual(self.gh.agent_labels(101), ["agent:changes-requested"])
        rounds = review.reviewed_rounds(self.gh, S, 101)
        self.assertEqual([(r.number, r.blocking) for r in rounds], [(1, ("B1", "B2"))])
        self.assertEqual(review.ids_so_far(rounds), "B1 (round 1), B2 (round 1); next free: B3")

    def test_a_returning_id_goes_to_the_lead(self) -> None:
        self.review("request-changes", ["B1", "B2"])
        self.review("request-changes", ["B3"], head="b" * 40)  # new problems only: another fix round
        self.assertEqual(self.gh.agent_labels(101), ["agent:changes-requested"])
        self.review("request-changes", ["B2", "B4"], head="c" * 40)
        self.assertEqual(self.gh.agent_labels(101), ["agent:needs-decision"])
        self.assertTrue(any("Blocking item B2 came back" in b for b in self.gh.bodies(101)))

    def test_a_lead_decision_starts_the_check_afresh(self) -> None:
        self.review("request-changes", ["B1"])
        self.gh.say(101, "<!-- agent:lead -->\n**Decision:** fix")
        self.review("request-changes", ["B1"], head="b" * 40)
        self.assertEqual(self.gh.agent_labels(101), ["agent:changes-requested"])
        self.review("request-changes", ["B1"], head="c" * 40)
        self.assertEqual(self.gh.agent_labels(101), ["agent:needs-decision"])

    def test_approve_records_no_ids_and_still_approves(self) -> None:
        io = self.review("approve", [])
        body = self.gh.bodies(101)[-1]
        self.assertIn(f"<!-- agent:reviewed {self.head} blocking=none -->", body)
        self.assertIn(f"<!-- agent:approved-sha {self.head} -->", body)
        self.assertEqual(self.gh.agent_labels(101), ["agent:approved"])
        self.assertFalse(any(line.startswith("::warning::") for line in io.log), io.log)

    def test_request_changes_without_ids_warns(self) -> None:
        io = self.review("request-changes", [])
        self.assertEqual(self.gh.agent_labels(101), ["agent:changes-requested"])
        self.assertTrue(any("without blocking IDs" in line for line in io.log), io.log)

    def test_a_run_without_a_comment_records_nothing_on_an_older_round(self) -> None:
        self.gh.say(101, "<!-- agent:reviewer -->\n**Verdict:** request-changes")  # from before rounds were recorded
        self.gh.say(101, f"<!-- agent:reviewer-retry {self.head} -->")  # its one retry is used up
        review.reviewer_apply(self.gh, S, step.StepIO(), 101, head=self.head, raw="", total=1, round_=2, qa=review.QaRules())
        self.assertEqual(self.gh.agent_labels(101), ["agent:needs-decision"])
        self.assertFalse(any("agent:reviewed" in b for b in self.gh.bodies(101)))

    def test_the_guard_gives_ids_changes_since_and_unplanned_files(self) -> None:
        self.gh.say(11, '<!-- agent:files ["apps/web/src/b.ts"] -->')
        first = self.head
        self.gh.diff(first, [FileChange("apps/web/src/a.ts", "modified", "@@ -1 +1 @@\n-x\n+y", None, 1)])
        self.review("request-changes", ["B1"])
        second = "d" * 40
        self.gh.diff(
            second,
            [
                FileChange("apps/web/src/a.ts", "modified", "@@ -1 +1 @@\n-x\n+z", None, 1),
                FileChange("apps/web/tests/a.spec.ts", "added", "@@ -0,0 +1 @@\n+t", None, 1),
                FileChange("package-lock.json", "modified", "@@ -1 +1 @@\n-1\n+2", None, 1),
            ],
        )
        self.gh.set_head(101, second)
        self.gh.set(101, labels=["agent:review"])
        cwd = os.getcwd()
        with tempfile.TemporaryDirectory() as d:
            os.chdir(d)
            try:
                io = step.StepIO()
                review.reviewer_guard(self.gh, S, io, 101, head=second, action="synchronize", qa=review.QaRules(), skip_same=False, max_rounds=3)
                self.assertNotIn("stop", io.outputs)
                self.assertEqual(io.outputs["ids"], "B1 (round 1); next free: B2")
                self.assertEqual(io.outputs["previous"], first)
                self.assertIn("+z", read(io.outputs["since"]))
                self.assertEqual(io.outputs["unplanned"], "`apps/web/src/a.ts`")
            finally:
                os.chdir(cwd)

    def test_markers_the_reviewer_writes_itself_never_count(self) -> None:
        # Seen on #107: the Reviewer copied the marker into its own text. A full-length copy must neither
        # make this round look like an earlier one nor replace what the workflow records.
        forged = f"\n<!-- agent:reviewed {'e' * 40} blocking=B1 -->"
        self.review("request-changes", ["B1"], text=forged)
        self.assertEqual(self.gh.agent_labels(101), ["agent:changes-requested"])
        self.review("request-changes", ["B2"], head="b" * 40, text=f"\n<!-- agent:reviewed {'f' * 40} blocking=B9 -->")
        self.assertEqual(self.gh.agent_labels(101), ["agent:changes-requested"])
        rounds = review.reviewed_rounds(self.gh, S, 101)
        self.assertEqual([(r.sha, r.blocking) for r in rounds], [(self.head, ("B1",)), ("b" * 40, ("B2",))])

    def test_blocking_ids(self) -> None:
        self.assertEqual(review.blocking_ids({"blocking": ["B2", " B1 ", "B0", "b3", 4, "B2"]}), ["B2", "B1"])
        self.assertEqual(review.blocking_ids({"blocking": "B1"}), [])
        self.assertEqual(review.ids_so_far([]), "none yet; next free: B1")


if __name__ == "__main__":
    unittest.main()
