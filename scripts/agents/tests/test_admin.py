"""Setting a repository up for the agent team: the labels, and the doctor's checks."""

import json
import unittest
from typing import Any

from agentflow import doctor, labels
from agentflow.github import GhCli, GhError

REPO = "o/r"


class Api:
    """Scripted answers for `gh api <path>`: path -> JSON-able value, or an Exception to raise."""

    def __init__(self, answers: dict[str, Any]) -> None:
        self.answers = answers
        self.calls: list[list[str]] = []

    def __call__(self, args: list[str], stdin: str | None = None) -> str:
        self.calls.append(args)
        path = next((a for a in args if a.startswith(("repos/", "user/"))), None)
        if path is None:
            return ""  # not an API call (e.g. gh label create)
        found = self.answers.get(path.split("?")[0], GhError(f"HTTP 404: {path}"))
        if isinstance(found, Exception):
            raise found
        if "--slurp" in args:
            found = [found]
        return found if isinstance(found, str) else json.dumps(found)


def healthy(**overrides: Any) -> dict[str, Any]:
    files: dict[str, Any] = {f"repos/{REPO}/contents/{f}": {} for f in (*doctor.TOOLKIT_FILES, ".github/ISSUE_TEMPLATE/agent-task.yml")}
    answers: dict[str, Any] = {
        f"repos/{REPO}": {"default_branch": "main", "private": False, "allow_squash_merge": True, "allow_merge_commit": False, "allow_rebase_merge": False},
        f"repos/{REPO}/actions/variables": {
            "variables": [{"name": "AGENT_APP_ID", "value": "1"}, {"name": "AGENT_BOT_ID", "value": "999"}, {"name": "AGENT_AUTO_MERGE", "value": "true"}]
        },
        f"repos/{REPO}/actions/organization-variables": {"variables": []},
        f"repos/{REPO}/actions/secrets": {"secrets": [{"name": "AGENT_APP_PRIVATE_KEY"}, {"name": "CLAUDE_CODE_OAUTH_TOKEN"}]},
        f"repos/{REPO}/actions/organization-secrets": {"secrets": []},
        "user/999": {"login": "agents[bot]"},
        f"repos/{REPO}/labels": [{"name": label.name} for label in labels.LABELS],
        f"repos/{REPO}/actions/workflows": {"workflows": [{"name": "CI"}, {"name": "Agent · Integrator"}]},
        f"repos/{REPO}/actions/permissions": {"enabled": True},
        **files,
    }
    answers.update(overrides)
    return answers


def check(answers: dict[str, Any], up: bool = True) -> tuple[int, list[str]]:
    return doctor.run(GhCli(REPO, runner=Api(answers)), REPO, reachable=lambda _: up)


class LabelsTest(unittest.TestCase):
    def test_every_state_the_tooling_uses_has_a_label(self) -> None:
        names = {label.name for label in labels.LABELS}
        for state in ("agent:start", "agent:blocked", "agent:split", "agent:queued", "agent:integrating", "agent:needs-human", "risk:high"):
            self.assertIn(state, names)
        self.assertEqual(len(names), len(labels.LABELS))

    def test_setup_creates_or_updates_them_all(self) -> None:
        api = Api({})
        labels.setup(GhCli(REPO, runner=api))
        self.assertEqual(len(api.calls), len(labels.LABELS))
        self.assertEqual(
            api.calls[0],
            ["label", "create", "agent:start", "-R", REPO, "--color", "ededed", "--description", "Ask the Analyst agent to pick up this issue", "--force"],
        )


class DoctorTest(unittest.TestCase):
    def test_a_repository_that_is_set_up(self) -> None:
        errors, out = check(healthy())
        self.assertEqual(errors, 0, "\n".join(out))
        self.assertIn("✅ AGENT_BOT_ID 999 is agents[bot]", out)
        self.assertIn("✅ all agent labels exist", out)
        self.assertIn("✅ required check `CI` is a workflow", out)
        self.assertEqual(out[-1], "0 to fix, 0 to look at.")

    def test_what_must_be_fixed(self) -> None:
        errors, out = check(
            healthy(
                **{
                    f"repos/{REPO}/actions/variables": {
                        "variables": [
                            {"name": "AGENT_BOT_ID", "value": "5"},
                            {"name": "AGENT_REQUIRED_CHECKS", "value": "Build@web/"},
                            {"name": "AGENT_MERGE_METHOD", "value": "rebase"},
                        ]
                    },
                    "user/5": {"login": "someone"},
                    f"repos/{REPO}/labels": [{"name": "agent:start"}],
                    f"repos/{REPO}/contents/scripts/agents/agent.sh": GhError("HTTP 404"),
                }
            )
        )
        text = "\n".join(out)
        for expected in (
            "❌ variable AGENT_APP_ID is missing",
            "❌ AGENT_BOT_ID 5 is someone, not a bot account",
            "❌ missing on `main` (scripts/install.sh copies them): scripts/agents/agent.sh",
            "❌ labels missing (run scripts/agents/agent.sh setup-labels o/r):",
            "❌ required check `Build` (AGENT_REQUIRED_CHECKS) matches no workflow name",
            "❌ AGENT_MERGE_METHOD=rebase, but the repository doesn't allow rebase merges",
            "⚠️  every required check in AGENT_REQUIRED_CHECKS is scoped to paths",
            "⚠️  AGENT_AUTO_MERGE isn't true",
        ):
            self.assertIn(expected, text)
        self.assertEqual(errors, 6)

    def test_without_admin_access_it_says_so_instead_of_reporting_things_missing(self) -> None:
        errors, out = check(healthy(**{f"repos/{REPO}/actions/variables": GhError("HTTP 403"), f"repos/{REPO}/actions/secrets": GhError("HTTP 403")}))
        text = "\n".join(out)
        self.assertIn("can't read the repository's variables", text)
        self.assertIn("can't list secrets (needs admin access): check AGENT_APP_PRIVATE_KEY yourself", text)
        self.assertNotIn("variable AGENT_APP_ID is missing", text)
        self.assertEqual(errors, 0)

    def test_an_unreadable_repository(self) -> None:
        self.assertEqual(check({}), (1, ["❌ can't read o/r with gh (logged in? access?)"]))

    def test_qa_settings_that_do_not_fit(self) -> None:
        variables = [
            {"name": n, "value": v}
            for n, v in (
                ("AGENT_APP_ID", "1"),
                ("AGENT_BOT_ID", "999"),
                ("AGENT_QA", "true"),
                ("AGENT_PREVIEW_URL", "none"),
                ("AGENT_QA_STAGE", "later"),
                ("AGENT_PRODUCTION_CHECK_URL", "https://x/version"),
            )
        ]
        errors, out = check(healthy(**{f"repos/{REPO}/actions/variables": {"variables": variables}}), up=False)
        text = "\n".join(out)
        self.assertIn("❌ AGENT_QA_STAGE must be queue or review, not 'later'", text)
        self.assertIn("❌ AGENT_PREVIEW_URL=none needs AGENT_QA_START_COMMAND", text)
        self.assertIn("⚠️  AGENT_PRODUCTION_CHECK_URL (https://x/version) doesn't answer", text)
        self.assertEqual(errors, 2)

    def test_a_risk_policy_should_be_protected(self) -> None:
        _, out = check(healthy(**{f"repos/{REPO}/contents/CLAUDE.md": "# Guide\n\n## Risk policy\n- high: …\n"}))
        self.assertTrue(any("CLAUDE.md has a risk policy, but an agent PR could change it" in line for line in out))


if __name__ == "__main__":
    unittest.main()
