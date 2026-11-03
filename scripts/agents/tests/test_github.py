"""GhCli: which `gh` calls it makes and how it reads their output (no processes: a scripted runner)."""

import json
import unittest

from agentflow.github import GhCli, GhError


class Runner:
    def __init__(self, *outputs: object, fail: str | None = None) -> None:
        self.outputs = list(outputs)
        self.calls: list[list[str]] = []
        self.fail = fail

    def __call__(self, args: list[str], stdin: str | None = None) -> str:
        self.calls.append(args)
        if self.fail:
            raise GhError(self.fail)
        out = self.outputs.pop(0) if self.outputs else ""
        return out if isinstance(out, str) else json.dumps(out)


def cli(*outputs: object, fail: str | None = None) -> tuple[GhCli, Runner]:
    r = Runner(*outputs, fail=fail)
    return GhCli("o/r", runner=r), r


class GhCliTest(unittest.TestCase):
    def test_issue(self) -> None:
        gh, r = cli(
            {
                "number": 5,
                "id": 105,
                "title": "T",
                "body": None,
                "state": "closed",
                "state_reason": "not_planned",
                "user": {"id": 999},
                "labels": [{"name": "agent:split"}],
                "pull_request": None,
            }
        )
        i = gh.issue(5)
        self.assertEqual(r.calls, [["api", "repos/o/r/issues/5"]])
        self.assertEqual(
            (i.number, i.id, i.body, i.state, i.state_reason, i.author_id, i.labels, i.is_pr),
            (5, 105, "", "closed", "not_planned", 999, ("agent:split",), False),
        )
        gh, _ = cli({"number": 6, "id": 1, "user": {"id": 1}, "labels": [], "pull_request": {"url": "x"}})
        self.assertTrue(gh.issue(6).is_pr)

    def test_paginated_lists_are_flattened(self) -> None:
        gh, r = cli([[{"id": 1, "user": {"id": 2}, "body": "a", "created_at": "t1"}], [{"id": 3, "user": {"id": 4}, "body": None, "created_at": "t2"}]])
        cs = gh.comments(7)
        self.assertEqual(r.calls, [["api", "--paginate", "--slurp", "repos/o/r/issues/7/comments"]])
        self.assertEqual([(x.id, x.author_id, x.body) for x in cs], [(1, 2, "a"), (3, 4, "")])

    def test_label_events_keep_only_labeled(self) -> None:
        gh, r = cli(
            [
                [
                    {"event": "labeled", "label": {"name": "a"}, "created_at": "t1"},
                    {"event": "unlabeled", "label": {"name": "a"}, "created_at": "t2"},
                    {"event": "assigned", "created_at": "t3"},
                ]
            ]
        )
        self.assertEqual([(e.label, e.created_at) for e in gh.label_events(7)], [("a", "t1")])
        self.assertEqual(r.calls[0], ["api", "--paginate", "--slurp", "repos/o/r/issues/7/events"])

    def test_writes(self) -> None:
        gh, r = cli()
        gh.add_label(7, "agent:ready")
        gh.remove_label(7, "agent:needs human")
        gh.comment(7, "hi")
        gh.edit_comment(42, "new")
        gh.assign(7, "someone")
        gh.link_sub_issue(7, 1234)
        gh.close_issue(7, "not planned")
        gh.create_label("agent:split", "bfdadc", "desc")
        self.assertEqual(
            r.calls,
            [
                ["api", "-X", "POST", "repos/o/r/issues/7/labels", "-f", "labels[]=agent:ready"],
                ["api", "-X", "DELETE", "repos/o/r/issues/7/labels/agent%3Aneeds%20human"],
                ["api", "repos/o/r/issues/7/comments", "-f", "body=hi"],
                ["api", "-X", "PATCH", "repos/o/r/issues/comments/42", "-f", "body=new"],
                ["api", "-X", "POST", "repos/o/r/issues/7/assignees", "-f", "assignees[]=someone"],
                ["api", "-X", "POST", "repos/o/r/issues/7/sub_issues", "-F", "sub_issue_id=1234"],
                ["issue", "close", "7", "-R", "o/r", "--reason", "not planned"],
                ["label", "create", "agent:split", "-R", "o/r", "--color", "bfdadc", "--description", "desc", "--force"],
            ],
        )

    def test_open_issues_and_create(self) -> None:
        gh, r = cli([{"number": 3}, {"number": 9}], "https://github.com/o/r/issues/12\n")
        self.assertEqual(gh.open_issues("agent:blocked"), [3, 9])
        self.assertEqual(gh.create_issue("Title", "Body"), 12)
        self.assertEqual(r.calls[0], ["issue", "list", "-R", "o/r", "--state", "open", "--label", "agent:blocked", "--limit", "100", "--json", "number"])
        self.assertEqual(r.calls[1][:6], ["issue", "create", "-R", "o/r", "--title", "Title"])
        self.assertEqual(r.calls[1][6], "--body-file")

    def test_pr_closing_issue(self) -> None:
        gh, r = cli({"closingIssuesReferences": [{"number": 11}]}, {"closingIssuesReferences": []})
        self.assertEqual(gh.pr_closing_issue(101), 11)
        self.assertIsNone(gh.pr_closing_issue(102))
        self.assertEqual(r.calls[0], ["pr", "view", "101", "-R", "o/r", "--json", "closingIssuesReferences"])

    def test_errors_propagate(self) -> None:
        gh, _ = cli(fail="HTTP 502")
        with self.assertRaises(GhError):
            gh.labels(1)


if __name__ == "__main__":
    unittest.main()


class GhCliEdgeTest(unittest.TestCase):
    def test_output_that_is_not_json(self) -> None:
        gh, _ = cli("<html>rate limited</html>")
        with self.assertRaises(GhError):
            gh.issue(1)

    def test_create_without_an_issue_url(self) -> None:
        gh, _ = cli("something went wrong\n")
        with self.assertRaises(GhError):
            gh.create_issue("t", "b")

    def test_empty_output_reads_as_nothing(self) -> None:
        gh, _ = cli("", "")
        self.assertEqual(gh.labels(1), [])
        self.assertEqual(gh.open_issues("x"), [])
