import io
import json
import os
import tempfile
import unittest

from agentflow import cli
from tests.fake import BOT, FakeGitHub

ENV = {"GITHUB_REPOSITORY": "o/r", "AGENT_BOT_ID": str(BOT), "GITHUB_RUN_ID": "7"}


def run(gh: FakeGitHub, *argv: str, **env: str) -> tuple[int, str, str]:
    out, err = io.StringIO(), io.StringIO()
    code = cli.main(list(argv), gh=gh, env={**ENV, **env}, stdout=out, stderr=err)
    return code, out.getvalue(), err.getvalue()


class CliTest(unittest.TestCase):
    def test_transition_and_count_comments(self) -> None:
        gh = FakeGitHub()
        gh.add_issue(7, labels=("agent:start",))
        self.assertEqual(run(gh, "transition", "7", "agent:analyzed"), (0, "#7 -> agent:analyzed\n", ""))
        self.assertEqual(run(gh, "transition", "7"), (0, "#7 -> <cleared>\n", ""))
        gh.say(7, "<!-- agent:lead -->")
        self.assertEqual(run(gh, "count-comments", "7", "lead"), (0, "1\n", ""))
        self.assertEqual(run(gh, "lead-budget", "7"), (0, "1\n", ""))

    def test_progress(self) -> None:
        gh = FakeGitHub()
        gh.add_issue(7)
        gh.add_issue(101, pr=True)
        gh.items[101].closing_issue = 7
        self.assertEqual(run(gh, "progress", "7", "a line")[0], 0)
        self.assertEqual(run(gh, "progress", "--pr", "101", "pr line")[0], 0)
        body = gh.bodies(7)[0]
        self.assertIn("a line · [run](https://github.com/o/r/actions/runs/7)", body)
        self.assertIn("pr line", body)
        gh.fail_on = {"comments"}
        self.assertEqual(run(gh, "progress", "7", "x")[0], 0)  # never fails the calling step

    def test_split_mode_reads_the_variables(self) -> None:
        gh = FakeGitHub()
        gh.add_issue(1)
        self.assertEqual(run(gh, "split-mode", "1"), (0, "allowed\n", ""))
        self.assertEqual(run(gh, "split-mode", "1", AGENT_SPLIT="false")[1], "not-allowed splitting is turned off (AGENT_SPLIT)\n")
        gh.add_issue(2, author=BOT, body="<!-- agent:sub-issue parent=1 depends= -->")
        self.assertTrue(run(gh, "split-mode", "2", AGENT_MAX_SPLIT_DEPTH="1")[1].startswith("not-allowed"))

    def test_split_reads_a_plan_file_and_reports_a_bad_plan(self) -> None:
        gh = FakeGitHub()
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
        gh = FakeGitHub()
        gh.add_issue(5)
        self.assertEqual(run(gh, "subissues", "5")[1], "#5 was not created by the agents' bot, nothing to do\n")
        self.assertEqual(run(gh, "subissues", "--sweep")[1], "Swept open split issues\n")
        self.assertEqual(run(gh, "release-blocked"), (0, "", ""))

    def test_url(self) -> None:
        gh = FakeGitHub()
        self.assertEqual(run(gh, "url", "preview", "12")[1], "https://o.github.io/r/pr-12/\n")
        self.assertEqual(run(gh, "url", "production", AGENT_PRODUCTION_URL="https://{repo}.example/")[1], "https://r.example/\n")
        self.assertEqual(run(gh, "url", "preview", "1", AGENT_PREVIEW_URL="none"), (0, "", ""))
        self.assertEqual(run(gh, "url", "preview", "1", AGENT_PREVIEW_URL="deployment"), (0, "", ""))
        self.assertEqual(run(gh, "url", "staging")[0], 2)

    def test_errors(self) -> None:
        gh = FakeGitHub()
        gh.add_issue(7)
        gh.fail_on = {"labels"}
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
        gh = FakeGitHub()
        gh.add_issue(1)
        self.assertEqual(run(gh, "count-comments", "1", "lead", AGENT_BOT_ID="bot")[0], 1)
        self.assertEqual(run(gh, "split-mode", "1", AGENT_MAX_SPLIT_DEPTH="two")[0], 1)
        self.assertEqual(run(gh, "url", "preview", "1", GITHUB_REPOSITORY="")[0], 1)
        self.assertEqual(run(gh, "progress", "1", "line", GITHUB_REPOSITORY="")[0], 0)  # still never fails
        self.assertEqual(run(gh, "subissues", "abc")[0], 2)
        self.assertEqual(run(gh, "transition", "abc")[0], 2)
        self.assertEqual(run(gh, "--help")[0], 0)

    def test_an_unreadable_plan(self) -> None:
        gh = FakeGitHub()
        gh.add_issue(46)
        code, _, err = run(gh, "split", "46", "/no/such/plan.json")
        self.assertEqual(code, 1)
        self.assertIn("::error::Can't read the split plan", err)
