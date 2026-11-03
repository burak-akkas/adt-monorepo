import io
import json
import os
import tempfile
import unittest

from agentflow import cli
from agentflow.model import FileChange
from tests.support import BOT, Repo

ENV = {"GITHUB_REPOSITORY": "o/r", "AGENT_BOT_ID": str(BOT), "GITHUB_RUN_ID": "7"}


def run(gh: Repo, *argv: str, **env: str) -> tuple[int, str, str]:
    out, err = io.StringIO(), io.StringIO()
    code = cli.main(list(argv), gh=gh, env={**ENV, **env}, stdout=out, stderr=err)
    return code, out.getvalue(), err.getvalue()


class CliTest(unittest.TestCase):
    def test_transition_and_count_comments(self) -> None:
        gh = Repo()
        gh.add_issue(7, labels=("agent:start",))
        self.assertEqual(run(gh, "transition", "7", "agent:analyzed"), (0, "#7 -> agent:analyzed\n", ""))
        self.assertEqual(run(gh, "transition", "7"), (0, "#7 -> <cleared>\n", ""))
        gh.say(7, "<!-- agent:lead -->")
        self.assertEqual(run(gh, "count-comments", "7", "lead"), (0, "1\n", ""))
        self.assertEqual(run(gh, "lead-budget", "7"), (0, "1\n", ""))

    def test_progress(self) -> None:
        gh = Repo()
        gh.add_issue(7)
        gh.add_pr(101, issue=7)
        self.assertEqual(run(gh, "progress", "7", "a line")[0], 0)
        self.assertEqual(run(gh, "progress", "--pr", "101", "pr line")[0], 0)
        body = gh.bodies(7)[0]
        self.assertIn("a line · [run](https://github.com/o/r/actions/runs/7)", body)
        self.assertIn("pr line", body)
        gh.fail("issues/7/comments")
        self.assertEqual(run(gh, "progress", "7", "x")[0], 0)  # never fails the calling step

    def test_split_mode_reads_the_variables(self) -> None:
        gh = Repo()
        gh.add_issue(1)
        self.assertEqual(run(gh, "split-mode", "1"), (0, "allowed\n", ""))
        self.assertEqual(run(gh, "split-mode", "1", AGENT_SPLIT="false")[1], "not-allowed splitting is turned off (AGENT_SPLIT)\n")
        gh.add_issue(2, author=BOT, body="<!-- agent:sub-issue parent=1 depends= -->")
        self.assertTrue(run(gh, "split-mode", "2", AGENT_MAX_SPLIT_DEPTH="1")[1].startswith("not-allowed"))

    def test_split_reads_a_plan_file_and_reports_a_bad_plan(self) -> None:
        gh = Repo()
        gh.add_issue(46)
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
            json.dump({"subtasks": [{"title": "only", "summary": "s", "acceptance_criteria": []}]}, f)
        try:
            code, out, err = run(gh, "split", "46", f.name)
        finally:
            os.unlink(f.name)
        self.assertEqual((code, out), (1, ""))
        self.assertIn("::error::Split plan has 1 subtasks; expected 2 to 5", err)

    def test_subissues_and_release(self) -> None:
        gh = Repo()
        gh.add_issue(5)
        self.assertEqual(run(gh, "subissues", "5")[1], "#5 was not created by the agents' bot, nothing to do\n")
        self.assertEqual(run(gh, "subissues", "--sweep")[1], "Swept open split issues\n")
        self.assertEqual(run(gh, "release-blocked"), (0, "", ""))

    def test_url(self) -> None:
        gh = Repo()
        self.assertEqual(run(gh, "url", "preview", "12")[1], "https://o.github.io/r/pr-12/\n")
        self.assertEqual(run(gh, "url", "production", AGENT_PRODUCTION_URL="https://{repo}.example/")[1], "https://r.example/\n")
        self.assertEqual(run(gh, "url", "preview", "1", AGENT_PREVIEW_URL="none"), (0, "", ""))
        self.assertEqual(run(gh, "url", "preview", "1", AGENT_PREVIEW_URL="deployment"), (0, "", ""))
        self.assertEqual(run(gh, "url", "staging")[0], 2)

    def test_errors(self) -> None:
        gh = Repo()
        gh.add_issue(7)
        gh.fail("issues/7/labels")
        code, _, err = run(gh, "transition", "7", "agent:qa")
        self.assertEqual(code, 1)
        self.assertIn("HTTP 502", err)
        self.assertEqual(run(gh, "no-such-command")[0], 2)
        code, _, err = run(gh, "count-comments", "7", "lead", AGENT_BOT_ID="")
        self.assertEqual(code, 1)
        self.assertIn("AGENT_BOT_ID must be set", err)


if __name__ == "__main__":
    unittest.main()


class CliEdgeTest(unittest.TestCase):
    def test_bad_settings_and_arguments(self) -> None:
        gh = Repo()
        gh.add_issue(1)
        self.assertEqual(run(gh, "count-comments", "1", "lead", AGENT_BOT_ID="bot")[0], 1)
        self.assertEqual(run(gh, "split-mode", "1", AGENT_MAX_SPLIT_DEPTH="two")[0], 1)
        self.assertEqual(run(gh, "url", "preview", "1", GITHUB_REPOSITORY="")[0], 1)
        self.assertEqual(run(gh, "progress", "1", "line", GITHUB_REPOSITORY="")[0], 0)  # still never fails
        self.assertEqual(run(gh, "subissues", "abc")[0], 2)
        self.assertEqual(run(gh, "transition", "abc")[0], 2)
        self.assertEqual(run(gh, "--help")[0], 0)

    def test_an_unreadable_plan(self) -> None:
        gh = Repo()
        gh.add_issue(46)
        code, _, err = run(gh, "split", "46", "/no/such/plan.json")
        self.assertEqual(code, 1)
        self.assertIn("::error::Can't read the split plan", err)


class ReviewCommandsTest(unittest.TestCase):
    A = "a" * 40

    def test_approvals(self) -> None:
        gh = Repo()
        gh.add_pr(101, head=self.A)
        self.assertEqual(run(gh, "approved-sha", "101"), (0, "", ""))
        self.assertEqual(run(gh, "qa-passed", "101", self.A)[0], 1)
        self.assertEqual(run(gh, "same-own-changes", "101", self.A)[0], 1)
        self.assertEqual(run(gh, "clean-base-update", "101", self.A)[0], 1)
        self.assertEqual(run(gh, "approve", "101", self.A, "qa"), (0, "#101 -> agent:approved\n", ""))
        self.assertEqual(run(gh, "approved-sha", "101"), (0, self.A + "\n", ""))
        self.assertEqual(run(gh, "same-own-changes", "101", self.A), (0, self.A + "\n", ""))

    def test_own_diff_and_path_rules(self) -> None:
        gh = Repo()
        gh.add_pr(101, files=("web/a.ts",))
        head = gh.pr(101).head_sha
        self.assertEqual(run(gh, "own-diff", "main", head), (0, "=== web/a.ts (modified)\n+x\n", ""))
        gh.diff(head, [FileChange("img.png", "modified", None, None, 0)])
        self.assertEqual(run(gh, "own-diff", "main", head)[0], 2)
        gh.add_pr(102, files=("web/a.ts",))
        self.assertEqual(run(gh, "pr-paths", "required", "102", AGENT_REQUIRED_CHECKS="Web@web/, Api@api/"), (0, "Web\n", ""))
        self.assertEqual(run(gh, "pr-paths", "required", "102"), (0, "CI\n", ""))
        self.assertEqual(run(gh, "pr-paths", "touches", "102", "web/")[0], 0)
        self.assertEqual(run(gh, "pr-paths", "touches", "102", "api/")[0], 1)
        gh.fail("pulls/102/files")
        code, _, err = run(gh, "pr-paths", "touches", "102", "api/")
        self.assertEqual(code, 3)
        self.assertIn("injected failure", err)
        self.assertEqual(run(gh, "pr-paths", "sideways", "102")[0], 2)

    def test_guard_and_queue(self) -> None:
        gh = Repo()
        gh.add_pr(101, head=self.A, labels=("agent:needs-human",))
        self.assertEqual(run(gh, "pr-still-current", "101", self.A), (0, "skip=PR is waiting for a human\n", ""))
        gh.add_pr(102, head=self.A, labels=("agent:review",))
        self.assertEqual(run(gh, "pr-still-current", "102", self.A, "agent:review"), (0, "", ""))
        gh.add_pr(103, labels=("agent:queued",))
        self.assertEqual(run(gh, "queue")[1], "103 queued\n")
        self.assertEqual(run(gh, "queue-tidy"), (0, "", ""))
        self.assertEqual(run(gh, "sweep-conflicts", "100", "main")[0], 0)

    def test_conflict_avoidance(self) -> None:
        gh = Repo()
        gh.add_pr(101, files=("src/a.ts",))
        gh.add_issue(201, labels=("agent:waiting",))
        gh.say(201, '<!-- agent:files ["src/a.ts", "package-lock.json"] -->')
        self.assertEqual(run(gh, "overlap", "201"), (0, "#101 src/a.ts\n", ""))
        self.assertEqual(run(gh, "overlap", "201", AGENT_CONFLICT_IGNORE="src/*"), (0, "", ""))
        code, out, _ = run(gh, "release-waiting", AGENT_CONFLICT_WAIT_MINUTES="1")
        self.assertEqual(code, 0)
        self.assertIn("#201 released: it waited", out)
        self.assertEqual(gh.agent_labels(201), ["agent:ready"])
