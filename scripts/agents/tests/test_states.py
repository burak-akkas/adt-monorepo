import unittest
from datetime import datetime, timezone

from agentflow import states
from agentflow.config import Settings
from agentflow.github import GhError
from tests.support import BOT, Repo

NOW = datetime(2026, 11, 2, 21, 35, tzinfo=timezone.utc)


def settings(escalation_assignee: str = "") -> Settings:
    return Settings(repo="o/r", bot_id=BOT, run_url="https://github.com/o/r/actions/runs/7", escalation_assignee=escalation_assignee)


class TransitionTest(unittest.TestCase):
    def test_replaces_every_agent_state_and_keeps_other_labels(self) -> None:
        gh = Repo()
        gh.add_issue(7, labels=("risk:high", "agent:ready", "agent:in-progress"))
        self.assertEqual(states.transition(gh, settings(), 7, "agent:analyzed"), "#7 -> agent:analyzed")
        self.assertEqual(gh.all_labels(7), ["risk:high", "agent:analyzed"])

    def test_repeating_a_state_fires_a_fresh_labeled_event(self) -> None:
        gh = Repo()
        gh.add_issue(7, labels=("agent:approved",))
        states.transition(gh, settings(), 7, "agent:approved")
        self.assertEqual(gh.labeled(7), ["agent:approved", "agent:approved"])

    def test_clear(self) -> None:
        gh = Repo()
        gh.add_issue(7, labels=("agent:review", "bug"))
        self.assertEqual(states.transition(gh, settings(), 7, None), "#7 -> <cleared>")
        self.assertEqual(gh.all_labels(7), ["bug"])

    def test_escalation_assigns_and_records_progress(self) -> None:
        gh = Repo()
        gh.add_issue(7, labels=("agent:needs-decision",))
        states.transition(gh, settings(escalation_assignee="owner"), 7, "agent:needs-human", now=NOW)
        self.assertEqual(gh.assignees(7), ["owner"])
        self.assertIn("- `21:35` 👤 **Escalated to a human** · [run](https://github.com/o/r/actions/runs/7)", gh.bodies(7)[0])

    def test_escalating_a_pr_reports_on_its_issue(self) -> None:
        gh = Repo()
        gh.add_issue(11)
        gh.add_pr(101, labels=("agent:review",), issue=11)
        states.transition(gh, settings(), 101, "agent:needs-human", now=NOW)
        self.assertIn("👤 **Escalated to a human** on #101", gh.bodies(11)[0])

    def test_a_failed_assignment_does_not_fail_the_escalation(self) -> None:
        gh = Repo()
        gh.add_issue(7)
        gh.fail("assignees")
        states.transition(gh, settings(escalation_assignee="owner"), 7, "agent:needs-human")
        self.assertEqual(gh.agent_labels(7), ["agent:needs-human"])

    def test_a_failed_read_fails_instead_of_keeping_the_old_state(self) -> None:
        gh = Repo()
        gh.add_issue(7, labels=("agent:review",))
        gh.fail("issues/7/labels")
        with self.assertRaises(GhError):
            states.transition(gh, settings(), 7, "agent:qa")
        self.assertEqual(gh.agent_labels(7), ["agent:review"])


class ProgressTest(unittest.TestCase):
    def test_creates_then_appends_one_comment(self) -> None:
        gh = Repo()
        gh.add_issue(7)
        states.progress(gh, settings(), "first", issue=7, now=NOW)
        states.progress(gh, settings(), "second", issue=7, now=NOW)
        self.assertEqual(
            gh.bodies(7),
            [
                "<!-- agent:progress -->\n### 📋 Agent progress\n"
                "- `21:35` first · [run](https://github.com/o/r/actions/runs/7)\n"
                "- `21:35` second · [run](https://github.com/o/r/actions/runs/7)"
            ],
        )

    def test_ignores_progress_comments_not_written_by_the_bot(self) -> None:
        gh = Repo()
        gh.add_issue(7)
        gh.say(7, "<!-- agent:progress -->\nforged", author=1)
        states.progress(gh, settings(), "line", issue=7, now=NOW)
        self.assertEqual(len(gh.bodies(7)), 2)
        self.assertEqual(gh.bodies(7)[0], "<!-- agent:progress -->\nforged")

    def test_a_pr_without_a_linked_issue_is_skipped(self) -> None:
        gh = Repo()
        gh.add_pr(101)
        states.progress(gh, settings(), "line", pr=101, now=NOW)
        self.assertEqual(gh.bodies(101), [])

    def test_never_fails(self) -> None:
        gh = Repo()
        gh.add_issue(7)
        gh.fail("issues/7/comments")
        states.progress(gh, settings(), "line", issue=7, now=NOW)  # no exception
        gh.fail("closingIssuesReferences")
        states.progress(gh, settings(), "line", pr=7, now=NOW)


if __name__ == "__main__":
    unittest.main()
