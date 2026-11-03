"""Operations: the watchdog, the production check, App tokens and publishing to gh-pages."""

import base64
import json
import os
import subprocess
import tempfile
import unittest

from agentflow import pages, production, tokens, watchdog
from agentflow.watchdog import WatchConfig
from tests.support import FAKE_BIN, FakeClock, Repo
from tests.test_states import settings

S = settings()
T0 = 1577836800  # 2020-01-01T00:00:00Z, when the fake's events happen


class WatchdogTest(unittest.TestCase):
    def check(self, gh: Repo, minutes: int = 10, **kw: object) -> list[str]:
        cfg = WatchConfig(minutes=minutes, **kw)  # type: ignore[arg-type]
        return watchdog.check(gh, S, cfg, clock=FakeClock(now=T0 + 3600))

    def test_restarts_stalled_work_then_hands_it_on(self) -> None:
        gh = Repo()
        gh.add_issue(7, labels=("agent:ready",))
        out = self.check(gh)
        self.assertIn("#7 (issue) stalled in agent:ready for 59m, retries so far: 0", out)
        self.assertEqual(gh.labeled(7), ["agent:ready", "agent:ready"])
        self.assertTrue(gh.bodies(7)[0].startswith("<!-- agent:watchdog -->\n⏰ No progress for 59 minutes in `agent:ready`"))
        self.check(gh)
        out = self.check(gh)  # the third time: two retries were made, the Lead takes over
        self.assertEqual(gh.agent_labels(7), ["agent:needs-decision"])
        self.assertTrue(any("Still no progress in `agent:ready` after 2 watchdog retries. Handing to the Lead." in b for b in gh.bodies(7)))
        self.assertIn("Stalled items: 1", out)

    def test_a_stalled_lead_goes_to_a_human_and_a_lead_decision_resets_the_retries(self) -> None:
        gh = Repo()
        gh.add_issue(7, labels=("agent:needs-decision",))
        gh.say(7, "<!-- agent:watchdog -->")
        gh.say(7, "<!-- agent:watchdog -->")
        self.check(gh)
        self.assertEqual(gh.agent_labels(7), ["agent:needs-human"])
        gh = Repo()
        gh.add_issue(7, labels=("agent:analyzed",))
        gh.say(7, "<!-- agent:watchdog -->")
        gh.say(7, "<!-- agent:watchdog -->")
        gh.say(7, "<!-- agent:lead -->")
        self.check(gh)
        self.assertEqual(gh.agent_labels(7), ["agent:analyzed"])

    def test_leaves_alone_what_is_fresh_active_or_paused(self) -> None:
        gh = Repo()
        gh.add_issue(7, labels=("agent:ready",))
        gh.add_issue(8, labels=("agent:pr-open",))
        gh.add_pr(101, labels=("agent:review",), draft=True)
        gh.run_active("agent-implementor.yml", "in_progress", "T7")  # run titles are the item's title
        out = self.check(gh)
        self.assertIn("#7 agent:ready for 59m, but an agent run is active: waiting", out)
        self.assertEqual(self.check(gh, minutes=120), ["Stalled items: 0"])

    def test_an_agent_pr_without_a_state_gets_the_reviewer(self) -> None:
        gh = Repo()
        gh.add_pr(101)
        gh.add_pr(102, head_ref="human/x")
        gh.set(101, updated_at="2020-01-01T00:00:00Z")
        gh.set(102, updated_at="2020-01-01T00:00:00Z")
        self.check(gh)
        self.assertEqual((gh.agent_labels(101), gh.agent_labels(102)), (["agent:review"], []))
        self.assertIn("in `review pending`", gh.bodies(101)[0])

    def test_dry_run_changes_nothing(self) -> None:
        gh = Repo()
        gh.add_issue(7, labels=("agent:ready",))
        out = self.check(gh, dry_run=True)
        self.assertIn("  would run: transition 7 agent:ready", out)
        self.assertEqual(gh.labeled(7), ["agent:ready"])

    def test_restarts_an_idle_merge_queue(self) -> None:
        gh = Repo()
        gh.add_pr(104, labels=("agent:queued",))
        out = self.check(gh, auto_merge=True)
        self.assertIn("Merge queue: 1 PR(s) but no Integrator run, restarting it at #104", out)
        self.assertEqual(gh.labeled(104), ["agent:queued", "agent:queued"])
        gh.run_active("agent-integrator.yml", "queued", "x")
        self.assertIn("Merge queue: 1 PR(s), an Integrator run is active", self.check(gh, auto_merge=True))


class ProductionTest(unittest.TestCase):
    SHA = "f" * 40

    def check(self, gh: Repo, body: str | None, base_head: str | None = None) -> tuple[bool, list[str]]:
        return production.check(
            gh,
            S,
            self.SHA,
            "main",
            "https://app.example/version.txt",
            minutes=1,
            fetch=lambda _: body,
            base_head=lambda _: base_head or self.SHA,
            clock=FakeClock(),
        )

    def test_serving_the_commit_is_fine_and_closes_an_earlier_failure(self) -> None:
        gh = Repo()
        self.assertEqual(self.check(gh, "version " + self.SHA), (True, [f"Production serves {self.SHA}"]))
        self.assertEqual(gh.numbers(), [])
        ok, _ = self.check(gh, "old")
        self.assertFalse(ok)
        [n] = gh.numbers()
        self.assertEqual(gh.agent_labels(n), ["agent:needs-human"])
        self.assertIn("<!-- agent:production-check -->", gh.body(n))
        self.check(gh, "still old")
        self.assertIn("⚠️ Still failing.", gh.bodies(n)[-1])
        self.check(gh, self.SHA)
        self.assertEqual(gh.issue_state(n)[0], "CLOSED")

    def test_a_newer_merge_takes_over(self) -> None:
        gh = Repo()
        ok, out = self.check(gh, None, base_head="e" * 40)
        self.assertTrue(ok)
        self.assertIn("the newer merge's check takes over", out[0])


class TokenTest(unittest.TestCase):
    def setUp(self) -> None:
        self.dir = tempfile.mkdtemp()
        self.key = subprocess.run(["openssl", "genrsa", "2048"], capture_output=True, text=True, check=True).stdout
        self.env = {
            "GITHUB_REPOSITORY": "o/r",
            "AGENT_APP_ID": "123",
            "AGENT_APP_PRIVATE_KEY": self.key,
            "GH_TOKEN": "ghs_start",
            "AGENT_TOKEN_CACHE": os.path.join(self.dir, "cache"),
            "FAKE_CURL_LOG": os.path.join(self.dir, "curl.log"),
            "PATH": FAKE_BIN + os.pathsep + os.environ["PATH"],
        }

    def test_without_an_app_the_token_is_unchanged(self) -> None:
        self.assertEqual(tokens.app_token({"GH_TOKEN": "x"}, FakeClock()), "x")

    def test_reuses_a_young_token_and_mints_a_new_one_before_it_expires(self) -> None:
        with open(self.env["AGENT_TOKEN_CACHE"], "w") as f:
            f.write(f"{T0} ghs_cached\n")
        self.assertEqual(tokens.app_token(self.env, FakeClock(now=T0 + 2000)), "ghs_cached")
        fresh = tokens.app_token(self.env, FakeClock(now=T0 + 2800))
        self.assertTrue(fresh.startswith("ghs_fresh"))
        with open(self.env["AGENT_TOKEN_CACHE"]) as f:
            self.assertEqual(f.read(), f"{T0 + 2800} {fresh}\n")
        with open(self.env["FAKE_CURL_LOG"]) as log:
            calls = [json.loads(line) for line in log]
        self.assertEqual([c["url"].rsplit("/", 1)[-1] for c in calls], ["installation", "access_tokens"])
        self.assertEqual(json.loads(calls[1]["body"]), {"repositories": ["r"]})
        jwt = calls[0]["auth"].removeprefix("Authorization: Bearer ")
        header, payload, _ = jwt.split(".")
        claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        self.assertEqual(claims, {"iat": T0 + 2800 - 60, "exp": T0 + 2800 + 540, "iss": "123"})
        self.assertEqual(json.loads(base64.urlsafe_b64decode(header + "==")), {"alg": "RS256", "typ": "JWT"})


class PagesTest(unittest.TestCase):
    def git(self, *args: str, cwd: str | None = None) -> str:
        return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, check=True).stdout

    def setUp(self) -> None:
        d = tempfile.mkdtemp()
        self.remote, self.src = os.path.join(d, "pages.git"), os.path.join(d, "src")
        self.git("init", "-q", "--bare", "-b", "gh-pages", self.remote)
        seed = os.path.join(d, "seed")
        self.git("clone", "-q", self.remote, seed)
        self.git("-c", "user.name=t", "-c", "user.email=t@x", "commit", "-q", "--allow-empty", "-m", "start", cwd=seed)
        os.makedirs(os.path.join(seed, "pr-1"))
        open(os.path.join(seed, "pr-1", "old.html"), "w").close()
        self.git("add", "-A", cwd=seed)
        self.git("-c", "user.name=t", "-c", "user.email=t@x", "commit", "-q", "-m", "old preview", cwd=seed)
        self.git("push", "-q", "origin", "HEAD:gh-pages", cwd=seed)
        os.makedirs(self.src)
        with open(os.path.join(self.src, "index.html"), "w") as f:
            f.write("<p>new</p>")

    def files(self) -> list[str]:
        return sorted(self.git("--git-dir", self.remote, "ls-tree", "-r", "--name-only", "gh-pages").split())

    def test_publishes_and_replaces_a_preview(self) -> None:
        out = pages.publish(self.src, "pr-1", "preview", replace=True, remote=self.remote, sleep=lambda _: None)
        self.assertEqual(out, "Published pr-1 (attempt 1)")
        self.assertEqual(self.files(), [".nojekyll", "pr-1/index.html"])
        self.assertEqual(pages.publish(self.src, "pr-1", "again", replace=True, remote=self.remote, sleep=lambda _: None), "Nothing to publish")
        pages.publish(self.src, ".", "root", remote=self.remote, sleep=lambda _: None)
        self.assertEqual(self.files(), [".nojekyll", "index.html", "pr-1/index.html"])

    def test_retries_when_another_workflow_pushed_first(self) -> None:
        hook = os.path.join(self.remote, "hooks", "pre-receive")
        with open(hook, "w") as f:  # rejects the first push, as a concurrent push would
            f.write(f'#!/bin/sh\n[ -e "{self.remote}/once" ] && exit 0\ntouch "{self.remote}/once"\nexit 1\n')
        os.chmod(hook, 0o755)
        slept: list[float] = []
        out = pages.publish(self.src, "qa/pr-1/9", "shots", remote=self.remote, sleep=slept.append)
        self.assertEqual((out, slept), ("Published qa/pr-1/9 (attempt 2)", [3]))


if __name__ == "__main__":
    unittest.main()
