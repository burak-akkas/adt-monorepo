import unittest
from typing import Any, ClassVar

from agentflow import issues
from agentflow.issues import SplitError, SplitMode
from tests.fake import BOT, HUMAN, FakeGitHub
from tests.test_states import settings

S = settings()


def sub(gh: FakeGitHub, n: int, parent: int, depends: str = "", labels: tuple[str, ...] = ()) -> int:
    return gh.add_issue(n, author=BOT, labels=labels, body=f"Part of #{parent}.\n\n<!-- agent:sub-issue parent={parent} depends={depends} -->")


class LeadBudgetTest(unittest.TestCase):
    def test_counts_bot_decisions_since_the_last_escalation(self) -> None:
        gh = FakeGitHub()
        gh.add_issue(1)
        for _ in range(3):
            gh.say(1, "<!-- agent:lead -->\n## 🧭")
        gh.say(1, "<!-- agent:lead -->", author=HUMAN)
        self.assertEqual(issues.lead_budget(gh, S, 1), 3)
        gh.add_label(1, "agent:needs-human")
        self.assertEqual(issues.lead_budget(gh, S, 1), 0)
        gh.say(1, "<!-- agent:lead -->")
        self.assertEqual(issues.lead_budget(gh, S, 1), 1)

    def test_other_labels_do_not_reset_it(self) -> None:
        gh = FakeGitHub()
        gh.add_issue(1)
        gh.say(1, "<!-- agent:lead -->")
        gh.add_label(1, "agent:needs-decision")
        self.assertEqual(issues.lead_budget(gh, S, 1), 1)


class SplitModeTest(unittest.TestCase):
    def setUp(self) -> None:
        self.gh = FakeGitHub()
        self.gh.add_issue(46)
        sub(self.gh, 49, 46)
        sub(self.gh, 60, 49)

    def mode(self, n: int, **kw: object) -> SplitMode:
        return issues.split_mode(self.gh, S, n, **kw)  # type: ignore[arg-type]

    def test_depth(self) -> None:
        self.assertEqual(self.mode(46), SplitMode("allowed"))
        self.assertEqual(self.mode(49), SplitMode("allowed"))
        self.assertEqual(self.mode(60).kind, "not-allowed")
        self.assertIn("2 level(s)", self.mode(60).reason)
        self.assertEqual(self.mode(49, max_depth=1).kind, "not-allowed")

    def test_turned_off(self) -> None:
        self.assertEqual(self.mode(46, enabled=False), SplitMode("not-allowed", "splitting is turned off (AGENT_SPLIT)"))

    def test_a_marker_in_a_human_issue_is_no_parent(self) -> None:
        self.gh.add_issue(70, body="<!-- agent:sub-issue parent=60 depends= -->")
        self.assertEqual(self.mode(70), SplitMode("allowed"))

    def test_a_parent_cycle_ends(self) -> None:
        sub(self.gh, 80, 81)
        sub(self.gh, 81, 80)
        self.assertEqual(self.mode(80, max_depth=100).kind, "allowed")  # stops after 10 levels, no hang

    def test_required_while_a_bot_request_is_newer_than_the_design(self) -> None:
        gh = self.gh
        gh.say(46, "<!-- agent:architect -->")
        gh.say(46, "<!-- agent:split-required -->", author=HUMAN)
        self.assertEqual(self.mode(46).kind, "allowed")
        gh.say(46, "<!-- agent:split-required -->")
        self.assertEqual(self.mode(46).kind, "required")
        gh.say(46, "<!-- agent:architect -->")
        self.assertEqual(self.mode(46).kind, "allowed")

    def test_str(self) -> None:
        self.assertEqual(str(SplitMode("required")), "required")
        self.assertEqual(str(SplitMode("not-allowed", "why")), "not-allowed why")


class ReleaseBlockedTest(unittest.TestCase):
    def test_paths(self) -> None:
        gh = FakeGitHub()
        gh.add_issue(54)
        gh.add_issue(55)
        gh.add_issue(56, state="closed", reason="not_planned")
        gh.add_issue(1, labels=("agent:blocked",))
        gh.say(1, "<!-- agent:waits-on 54,55 -->")
        gh.add_issue(2, labels=("agent:blocked",))
        gh.say(2, "<!-- agent:waits-on 56 -->")
        gh.add_issue(3, labels=("agent:blocked",))  # a sibling-blocked sub-issue: not ours
        gh.add_issue(4, labels=("agent:blocked",))
        gh.say(4, "<!-- agent:waits-on 54 -->", author=HUMAN)
        out = issues.release_blocked(gh, S)
        self.assertEqual(out, ["#1 still waits for #54 #55", "#2: dependency #56 dropped, handed to the Lead"])
        self.assertEqual(gh.agent_labels(2), ["agent:needs-decision"])
        self.assertIn("closed as **not planned**", gh.bodies(2)[1])
        gh.close_issue(54, "completed")
        gh.close_issue(55, "completed")
        self.assertEqual(issues.release_blocked(gh, S), ["#1: dependencies done, back to the Implementor"])
        self.assertEqual(gh.agent_labels(1), ["agent:ready"])
        self.assertEqual(gh.agent_labels(3), ["agent:blocked"])

    def test_an_issue_closed_without_a_reason_or_as_a_duplicate_is_done(self) -> None:
        # Changed on purpose (bash only knew completed and not_planned, and waited forever otherwise).
        gh = FakeGitHub()
        gh.add_issue(54, state="closed", reason=None)
        gh.add_issue(55, state="closed", reason="duplicate")
        gh.add_issue(1, labels=("agent:blocked",))
        gh.say(1, "<!-- agent:waits-on 54,55 -->")
        self.assertEqual(issues.release_blocked(gh, S), ["#1: dependencies done, back to the Implementor"])

    def test_the_newest_marker_counts(self) -> None:
        gh = FakeGitHub()
        gh.add_issue(54, state="closed", reason="completed")
        gh.add_issue(60)
        gh.add_issue(1, labels=("agent:blocked",))
        gh.say(1, "<!-- agent:waits-on 54 -->")
        gh.say(1, "<!-- agent:waits-on 60 -->")
        self.assertEqual(issues.release_blocked(gh, S), ["#1 still waits for #60"])


class SubIssuesTest(unittest.TestCase):
    def tree(self) -> FakeGitHub:
        gh = FakeGitHub()
        gh.add_issue(46, labels=("agent:split",))
        sub(gh, 47, 46, labels=("agent:analyzed",))
        sub(gh, 48, 46, "47", labels=("agent:blocked",))
        sub(gh, 49, 46, "47,48", labels=("agent:blocked",))
        gh.say(46, "<!-- agent:split 47,48,49 -->")
        return gh

    def test_unblocks_in_dependency_order_and_closes_the_parent(self) -> None:
        gh = self.tree()
        gh.close_issue(47, "completed")
        self.assertEqual(issues.sub_issue_closed(gh, S, 47), ["Unblocked #48"])
        self.assertEqual((gh.agent_labels(48), gh.agent_labels(49)), (["agent:analyzed"], ["agent:blocked"]))
        gh.close_issue(48, "completed")
        self.assertEqual(issues.sub_issue_closed(gh, S, 48), ["Unblocked #49"])
        gh.close_issue(49, "completed")
        self.assertEqual(issues.sub_issue_closed(gh, S, 49), ["Closed #46"])
        self.assertEqual((gh.items[46].issue.state, gh.items[46].issue.state_reason), ("closed", "completed"))
        self.assertEqual(gh.agent_labels(46), ["agent:done"])
        self.assertIn("✅ All sub-issues are done:\n- #47\n- #48\n- #49\n\nClosing this issue.", gh.bodies(46))

    def test_a_sub_issue_closed_as_a_duplicate_counts_as_done(self) -> None:
        gh = self.tree()
        gh.close_issue(47, "duplicate")
        self.assertEqual(issues.sub_issue_closed(gh, S, 47), ["Unblocked #48"])

    def test_a_dropped_sub_issue_hands_the_parent_to_the_lead_once(self) -> None:
        gh = self.tree()
        gh.close_issue(47, "not_planned")
        self.assertEqual(issues.sub_issue_closed(gh, S, 47), ["#46: sub-issues closed as not planned, handed to the Lead"])
        self.assertEqual(gh.agent_labels(46), ["agent:needs-decision"])
        self.assertIn("Sub-issue(s) #47 were closed as **not planned**", gh.bodies(46)[-1])
        self.assertEqual(issues.sweep(gh, S), ["Swept open split issues"])  # no longer agent:split: left alone
        self.assertEqual(len([b for b in gh.bodies(46) if "not planned" in b]), 1)

    def test_a_child_parked_on_an_outside_dependency_is_left_to_release_blocked(self) -> None:
        gh = self.tree()
        gh.say(48, "<!-- agent:waits-on 54 -->")
        gh.close_issue(47, "completed")
        self.assertEqual(issues.sub_issue_closed(gh, S, 47), [])
        self.assertEqual(gh.agent_labels(48), ["agent:blocked"])

    def test_issues_that_are_not_bot_sub_issues_are_ignored(self) -> None:
        gh = FakeGitHub()
        gh.add_issue(5)
        gh.add_issue(6, body="<!-- agent:sub-issue parent=5 depends= -->")  # a human pasted the marker
        gh.add_issue(7, author=BOT)
        self.assertEqual(issues.sub_issue_closed(gh, S, 5), ["#5 was not created by the agents' bot, nothing to do"])
        self.assertEqual(issues.sub_issue_closed(gh, S, 6), ["#6 was not created by the agents' bot, nothing to do"])
        self.assertEqual(issues.sub_issue_closed(gh, S, 7), ["#7 is not a sub-issue"])

    def test_a_parent_without_a_split_marker(self) -> None:
        gh = FakeGitHub()
        gh.add_issue(46, labels=("agent:split",))
        self.assertEqual(issues.advance(gh, S, 46), ["::warning::#46 has no split marker"])

    def test_sweep_catches_up_on_every_split_issue(self) -> None:
        gh = self.tree()
        gh.close_issue(47, "completed")
        self.assertEqual(issues.sweep(gh, S), ["Unblocked #48", "Swept open split issues"])


class SplitTest(unittest.TestCase):
    PLAN: ClassVar[dict[str, list[dict[str, Any]]]] = {
        "subtasks": [
            {"title": "Data model", "summary": "Add the table.", "acceptance_criteria": ["a1", "a2"]},
            {"title": "UI", "summary": "Show it.", "acceptance_criteria": ["b1"], "depends_on": [1]},
        ]
    }

    def test_creates_linked_sub_issues_and_parks_the_parent(self) -> None:
        gh = FakeGitHub()
        gh.add_issue(46, labels=("agent:analyzed",))
        out = issues.split(gh, S, 46, self.PLAN)
        self.assertEqual(out, ["Created #47: Data model", "Created #48: UI", "Split #46 into #47, #48"])
        self.assertEqual(gh.items[47].issue.body, "Add the table.\n\nPart of #46.\n\n<!-- agent:sub-issue parent=46 depends= -->\n")
        self.assertEqual(
            gh.items[48].issue.body, "Show it.\n\nPart of #46.\nDepends on: #47 (starts when they are done).\n\n<!-- agent:sub-issue parent=46 depends=47 -->\n"
        )
        self.assertEqual((gh.agent_labels(47), gh.agent_labels(48), gh.agent_labels(46)), (["agent:analyzed"], ["agent:blocked"], ["agent:split"]))
        self.assertEqual(gh.items[46].sub_issues, [47, 48])
        analysis = gh.bodies(47)[0]
        self.assertTrue(analysis.startswith("<!-- agent:analyst -->\n## 🔍 Analyst\n"))
        self.assertIn("**Acceptance criteria**\n- [ ] a1\n- [ ] a2\n", analysis)
        self.assertIn(
            "<!-- agent:split 47,48 -->\n## 🧩 Split into 2 sub-issues\n\n- [ ] #47 Data model (starts now)\n- [ ] #48 UI (waits for #47)\n", gh.bodies(46)[0]
        )
        self.assertEqual(set(gh.labels_created), {"agent:split", "agent:blocked"})

    def test_rejects_bad_plans_before_creating_anything(self) -> None:
        gh = FakeGitHub()
        gh.add_issue(46)
        for plan in (
            {"subtasks": self.PLAN["subtasks"][:1]},
            {"subtasks": self.PLAN["subtasks"] * 3},
            {"subtasks": [self.PLAN["subtasks"][1], self.PLAN["subtasks"][0]]},
            {"subtasks": [{**self.PLAN["subtasks"][0], "depends_on": [1]}, self.PLAN["subtasks"][1]]},
        ):
            with self.assertRaises(SplitError):
                issues.split(gh, S, 46, plan)
        self.assertEqual(list(gh.items), [46])

    def test_a_failed_link_is_only_a_warning(self) -> None:
        gh = FakeGitHub()
        gh.add_issue(46)
        gh.fail_on = {"link_sub_issue"}
        out = issues.split(gh, S, 46, self.PLAN)
        self.assertIn("::warning::Could not link #47 as a sub-issue of #46", out)
        self.assertEqual(gh.agent_labels(46), ["agent:split"])


if __name__ == "__main__":
    unittest.main()
