import unittest

from agentflow import markers
from agentflow.model import Comment

BOT, HUMAN = 999, 1


def c(i: int, body: str, author: int = BOT) -> Comment:
    return Comment(id=i, author_id=author, body=body, created_at=f"2020-01-01T00:00:{i:02d}Z")


class MarkerTest(unittest.TestCase):
    def test_tag(self) -> None:
        self.assertEqual(markers.tag("lead"), "<!-- agent:lead -->")

    def test_only_the_bot_counts(self) -> None:
        cs = [c(1, "<!-- agent:lead -->"), c(2, "<!-- agent:lead -->", HUMAN), c(3, "x <!-- agent:lead --> y")]
        self.assertEqual(markers.count(cs, BOT, "lead"), 2)
        self.assertEqual([x.id for x in markers.from_bot(cs, BOT)], [1, 3])

    def test_last_index_is_among_the_bots_comments(self) -> None:
        cs = [c(1, "<!-- agent:architect -->"), c(2, "<!-- agent:split-required -->", HUMAN), c(3, "<!-- agent:split-required -->"), c(4, "noise")]
        bot = markers.from_bot(cs, BOT)
        self.assertEqual(markers.last_index(bot, markers.tag("architect")), 0)
        self.assertEqual(markers.last_index(bot, markers.tag("split-required")), 1)
        self.assertEqual(markers.last_index(bot, "nothing"), -1)

    def test_newer(self) -> None:
        bot = markers.from_bot([c(1, "<!-- agent:architect -->"), c(2, "<!-- agent:split-required -->")], BOT)
        self.assertTrue(markers.newer(bot, markers.tag("split-required"), markers.tag("architect")))
        self.assertFalse(markers.newer(bot, markers.tag("architect"), markers.tag("split-required")))
        self.assertFalse(markers.newer(bot, "absent", "also absent"))

    def test_latest_value_of_a_marker_with_a_payload(self) -> None:
        cs = [c(1, "<!-- agent:waits-on 54 -->"), c(2, "<!-- agent:waits-on 54,60 -->"), c(3, "<!-- agent:waits-on 7 -->", HUMAN)]
        self.assertEqual(markers.latest_value(markers.from_bot(cs, BOT), "waits-on"), "54,60")
        self.assertIsNone(markers.latest_value([], "waits-on"))

    def test_numbers(self) -> None:
        self.assertEqual(markers.numbers("54,60"), [54, 60])
        self.assertEqual(markers.numbers(""), [])
        self.assertEqual(markers.numbers(None), [])

    def test_sub_issue_marker(self) -> None:
        body = "Part of #46.\n\n<!-- agent:sub-issue parent=46 depends=47,48 -->"
        self.assertEqual(markers.sub_issue(body), (46, [47, 48]))
        self.assertEqual(markers.sub_issue("<!-- agent:sub-issue parent=46 depends= -->"), (46, []))
        self.assertIsNone(markers.sub_issue("no marker"))

    def test_split_marker(self) -> None:
        bot = markers.from_bot([c(1, "<!-- agent:split 47,48 -->"), c(2, "<!-- agent:split 50,51 -->\n## 🧩")], BOT)
        self.assertEqual(markers.split_children(bot), [50, 51])
        self.assertEqual(markers.split_children([]), [])


if __name__ == "__main__":
    unittest.main()
