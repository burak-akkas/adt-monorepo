"""Review and approvals: approved commits, QA passes, a PR's own edits, and the guard before a run."""

import os
import tempfile
import unittest

from agentflow import prs
from agentflow.github import GhError
from agentflow.model import Commit, FileChange
from agentflow.prs import IncompleteDiff
from tests.support import BOT, HUMAN, FakeClock, Repo
from tests.test_states import settings

S = settings()
A, B, C = "a" * 40, "b" * 40, "c" * 40


def approval(sha: str, role: str = "qa", verdict: str = "pass") -> str:
    return f"<!-- agent:{role} -->\n**Verdict:** {verdict}\n<!-- agent:approved-sha {sha} -->"


def edits(*lines: str, name: str = "src/a.ts", status: str = "modified", context: str = " ctx") -> FileChange:
    return FileChange(filename=name, status=status, patch="@@ -1,3 +1,3 @@\n" + context + "\n" + "\n".join(lines), previous_filename=None, changes=len(lines))


class ApprovedShaTest(unittest.TestCase):
    def test_latest_bot_marker(self) -> None:
        gh = Repo()
        gh.add_pr(101, head=A)
        self.assertIsNone(prs.approved_sha(gh, S, 101))
        gh.say(101, approval(A))
        gh.say(101, approval(B))
        gh.say(101, approval(C), author=HUMAN)
        gh.say(101, "<!-- agent:approved-sha tooshort -->")
        self.assertEqual(prs.approved_sha(gh, S, 101), B)


class ApproveTest(unittest.TestCase):
    def test_marks_the_latest_comment_of_the_role_and_approves(self) -> None:
        gh = Repo()
        gh.add_pr(101, head=A, labels=("agent:qa",))
        gh.say(101, "<!-- agent:qa -->\nold report")
        gh.say(101, "<!-- agent:qa -->\n**Verdict:** pass\n")
        gh.say(101, "<!-- agent:qa -->\nforged", author=HUMAN)
        self.assertEqual(prs.approve(gh, S, 101, A, "qa"), "#101 -> agent:approved")
        self.assertEqual(gh.bodies(101)[1], f"<!-- agent:qa -->\n**Verdict:** pass\n\n<!-- agent:approved-sha {A} -->")
        self.assertEqual(gh.agent_labels(101), ["agent:approved"])

    def test_without_a_comment_of_the_role_it_posts_the_marker(self) -> None:
        gh = Repo()
        gh.add_pr(101, head=A)
        prs.approve(gh, S, 101, A, "lead")
        self.assertEqual(gh.bodies(101), [f"<!-- agent:approved-sha {A} -->"])


class OwnDiffTest(unittest.TestCase):
    def test_lists_only_the_edits_sorted_by_file(self) -> None:
        gh = Repo()
        gh.diff(
            A,
            [
                edits("-old", "+new", name="z.ts"),
                FileChange("a.ts", "renamed", "@@ -1 +1 @@\n-x\n+y", "b.ts", 2),
                FileChange("moved.ts", "renamed", None, "old.ts", 0),
            ],
        )
        self.assertEqual(
            prs.own_diff(gh, "main", A), "=== a.ts (renamed from b.ts)\n-x\n+y\n=== moved.ts (renamed from old.ts)\n=== z.ts (modified)\n-old\n+new"
        )

    def test_an_incomplete_diff_cannot_be_compared(self) -> None:
        gh = Repo()
        gh.diff(A, [FileChange("img.png", "modified", None, None, 0)])
        gh.diff(B, [edits("+x", name=f"f{i}") for i in range(300)])
        for sha in (A, B):
            with self.assertRaises(IncompleteDiff):
                prs.own_diff(gh, "main", sha)


class SameOwnChangesTest(unittest.TestCase):
    def setUp(self) -> None:
        self.gh = Repo()
        self.gh.add_pr(101, head=B)
        self.gh.say(101, approval(A))
        self.gh.diff(A, [edits("-old", "+new")])
        self.gh.diff(B, [edits("-old", "+new", context=" other context")])
        self.gh.diff(C, [edits("-old", "+new", "+extra")])

    def test_the_same_edits_around_new_context(self) -> None:
        self.assertEqual(prs.same_own_changes(self.gh, S, 101, B), A)
        self.assertEqual(prs.same_own_changes(self.gh, S, 101, A), A)

    def test_new_edits_write_the_interdiff(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "i.diff")
            self.assertIsNone(prs.same_own_changes(self.gh, S, 101, C, path))
            with open(path, encoding="utf-8") as f:
                diff = f.read()
        self.assertTrue(diff.startswith(f"--- PR edits as approved ({A[:7]})\n+++ PR edits now ({C[:7]})\n@@ "), diff)
        self.assertIn("\n++extra\n", diff)  # the added line "+extra" is itself added

    def test_no_approval_or_an_incomplete_diff(self) -> None:
        gh = Repo()
        gh.add_pr(102, head=B)
        self.assertIsNone(prs.same_own_changes(gh, S, 102, B))
        self.gh.diff(B, [FileChange("img.png", "modified", None, None, 0)])
        self.assertIsNone(prs.same_own_changes(self.gh, S, 101, B))


class QaPassedTest(unittest.TestCase):
    def test_the_latest_qa_report_decides(self) -> None:
        gh = Repo()
        gh.add_pr(101, head=A)
        self.assertIsNone(prs.qa_passed(gh, S, 101, A))
        gh.say(101, approval(A))
        self.assertEqual(prs.qa_passed(gh, S, 101, A), A)
        gh.say(101, approval(A, verdict="fail"))
        self.assertIsNone(prs.qa_passed(gh, S, 101, A))
        gh.say(101, approval(A), author=HUMAN)  # a stranger's pass doesn't count
        self.assertIsNone(prs.qa_passed(gh, S, 101, A))

    def test_lead_and_human_approvals_count_but_other_markers_do_not(self) -> None:
        gh = Repo()
        gh.add_pr(101, head=A)
        gh.say(101, approval(A, verdict="fail"))
        gh.say(101, f"<!-- agent:integrator -->\n<!-- agent:approved-sha {A} -->")
        self.assertIsNone(prs.qa_passed(gh, S, 101, A))
        gh.say(101, f"<!-- agent:lead -->\n**Decision:** approve\n<!-- agent:approved-sha {A} -->")
        self.assertEqual(prs.qa_passed(gh, S, 101, A), A)
        gh.say(101, f"<!-- agent:queued -->\n🚦 Queued\n<!-- agent:approved-sha {B} -->")
        gh.diff(A, [edits("+x")])
        gh.diff(B, [edits("+x")])
        self.assertEqual(prs.qa_passed(gh, S, 101, A), B)

    def test_another_commit_with_the_same_own_edits(self) -> None:
        gh = Repo()
        gh.add_pr(101, head=B)
        gh.say(101, approval(A))
        gh.diff(A, [edits("+x")])
        gh.diff(B, [edits("+x", context=" moved")])
        self.assertEqual(prs.qa_passed(gh, S, 101, B), A)
        gh.diff(B, [edits("+x", "+y")])
        self.assertIsNone(prs.qa_passed(gh, S, 101, B))


class CleanBaseUpdateTest(unittest.TestCase):
    def setUp(self) -> None:
        self.gh = Repo()
        self.gh.add_pr(101, head=B)
        self.gh.say(101, approval(A))
        self.gh.commit_is(Commit(sha=B, parents=(A, C), author_id=BOT, committer_login="web-flow", verified=True))

    def test_githubs_clean_merge_of_the_base_on_the_approved_commit(self) -> None:
        self.assertEqual(prs.clean_base_update(self.gh, S, 101, B), A)
        self.gh.compare_is(C, "identical")
        self.assertEqual(prs.clean_base_update(self.gh, S, 101, B), A)

    def test_anything_else_is_not(self) -> None:
        good = Commit(sha=B, parents=(A, C), author_id=BOT, committer_login="web-flow", verified=True)
        for bad in (
            Commit(B, (A,), BOT, "web-flow", True),
            Commit(B, (C, A), BOT, "web-flow", True),
            Commit(B, (A, C), HUMAN, "web-flow", True),
            Commit(B, (A, C), BOT, "someone", True),
            Commit(B, (A, C), BOT, "web-flow", False),
        ):
            self.gh.commit_is(bad)
            self.assertIsNone(prs.clean_base_update(self.gh, S, 101, B), bad)
        self.gh.commit_is(good)
        self.gh.compare_is(C, "diverged")  # merged in a commit that isn't on the base
        self.assertIsNone(prs.clean_base_update(self.gh, S, 101, B))

    def test_without_an_approval(self) -> None:
        gh = Repo()
        gh.add_pr(102, head=B)
        self.assertIsNone(prs.clean_base_update(gh, S, 102, B))


class PrPathsTest(unittest.TestCase):
    def setUp(self) -> None:
        self.gh = Repo()
        self.gh.add_pr(101, head=A, files=("backend/a.py", "README.md"))

    def test_required_checks(self) -> None:
        def req(spec: str) -> list[str]:
            return prs.required_checks(self.gh, 101, spec)

        self.assertEqual(req("CI"), ["CI"])
        self.assertEqual(req(" Backend CI @ backend/|shared/ , Frontend CI@web/, Lint ,"), ["Backend CI", "Lint"])
        self.assertEqual(req("Docs@docs/"), [])

    def test_touches(self) -> None:
        self.assertTrue(prs.touches(self.gh, 101, "web/| backend/"))
        self.assertFalse(prs.touches(self.gh, 101, "web/"))
        self.assertTrue(prs.touches(self.gh, 101, "  "))  # no prefixes: everything matches

    def test_files_are_only_read_when_needed_and_a_failed_read_fails(self) -> None:
        self.gh.fail("pulls/101/files")
        self.assertEqual(prs.required_checks(self.gh, 101, "CI, Lint"), ["CI", "Lint"])
        with self.assertRaises(GhError):
            prs.required_checks(self.gh, 101, "CI@backend/")
        self.gh.add_pr(102)
        with self.assertRaises(GhError):  # a PR without files is an error, never "touches nothing"
            prs.touches(self.gh, 102, "web/")


class PrStillCurrentTest(unittest.TestCase):
    def check(self, gh: Repo, sha: str = A, required: str | None = None) -> str | None:
        return prs.still_current(gh, S, 101, sha, required, clock=FakeClock())

    def test_closed_draft_or_moved_on(self) -> None:
        for kw, want in (({"state": "MERGED"}, "PR is MERGED"), ({"draft": True}, "PR is a draft")):
            gh = Repo()
            gh.add_pr(101, head=A, **kw)
            self.assertEqual(self.check(gh), want)
        gh = Repo()
        gh.add_pr(101, head=B)
        self.assertEqual(self.check(gh), f"newer commit {B[:7]} was pushed, its own run handles it")

    def test_waiting_states(self) -> None:
        gh = Repo()
        gh.add_pr(101, head=A, labels=("agent:needs-decision",))
        self.assertEqual(self.check(gh), "PR is waiting in agent:needs-decision, re-queued its handler")
        self.assertEqual(gh.labeled(101), ["agent:needs-decision", "agent:needs-decision"])
        gh = Repo()
        gh.add_pr(101, head=A, labels=("agent:needs-human",))
        self.assertEqual(self.check(gh), "PR is waiting for a human")

    def test_in_the_queue(self) -> None:
        gh = Repo()
        gh.add_pr(101, head=A, labels=("agent:queued",), issue=11)
        gh.add_issue(11)
        gh.say(101, approval(A))
        self.assertEqual(self.check(gh), "PR is in the merge queue")
        gh.set_head(101, B)  # someone else pushed: out of the queue, and this run reviews it
        self.assertIsNone(self.check(gh, B))
        self.assertEqual(gh.agent_labels(101), [])
        self.assertIn("got new commits while it was in the merge queue", gh.bodies(101)[-1])
        self.assertIn("left the queue for review", gh.bodies(11)[-1])

    def test_required_label(self) -> None:
        gh = Repo()
        gh.add_pr(101, head=A, labels=("agent:review", "bug"))
        self.assertIsNone(self.check(gh, required="agent:review"))
        self.assertEqual(self.check(gh, required="agent:qa"), "PR no longer has agent:qa (labels: agent:review,bug)")
        gh = Repo()
        gh.add_pr(101, head=A)
        self.assertEqual(self.check(gh, required="agent:qa"), "PR no longer has agent:qa (labels: none)")

    def test_mergeability_is_retried_and_a_conflict_goes_to_the_implementor(self) -> None:
        gh = Repo()
        gh.add_pr(101, head=A, mergeable=("UNKNOWN", "UNKNOWN", "CONFLICTING"))
        clock = FakeClock()
        self.assertEqual(prs.still_current(gh, S, 101, A, None, clock=clock), "PR conflicts with main, sent to the Implementor")
        self.assertEqual(clock.slept, [10, 10])
        self.assertEqual(gh.agent_labels(101), ["agent:changes-requested"])
        self.assertTrue(gh.bodies(101)[0].startswith("<!-- agent:merge -->\n⚠️ This PR **conflicts** with `main`"))
        gh = Repo()
        gh.add_pr(101, head=A, mergeable=("UNKNOWN",))
        clock = FakeClock()
        self.assertIsNone(prs.still_current(gh, S, 101, A, None, clock=clock))  # stays unknown: go ahead
        self.assertEqual(len(clock.slept), 5)


if __name__ == "__main__":
    unittest.main()


class QueueRaceTest(unittest.TestCase):
    def test_an_api_error_never_takes_a_queued_pr_out_of_the_queue(self) -> None:
        # The Integrator's own update of an approved PR, and the API fails while the guard checks it:
        # that must stop this run, not eject the PR (the Integrator may be merging it right now).
        gh = Repo()
        gh.add_pr(101, head=B, labels=("agent:integrating",))
        gh.say(101, approval(A))
        gh.commit_is(Commit(sha=B, parents=(A, C), author_id=BOT, committer_login="web-flow", verified=True))
        gh.fail(f"commits/{B}")
        reason = prs.still_current(gh, S, 101, B, clock=FakeClock())
        self.assertEqual(reason, "PR is in the merge queue (couldn't check its new commits, the Integrator decides)")
        self.assertEqual(gh.agent_labels(101), ["agent:integrating"])
