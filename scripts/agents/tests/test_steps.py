"""What the workflow steps share, and the pieces of their logic worth testing on their own."""

import json
import os
import tempfile
import unittest

from agentflow import prs, qa_run, review, roles, step
from agentflow.model import Check
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


if __name__ == "__main__":
    unittest.main()
