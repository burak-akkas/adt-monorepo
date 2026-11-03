"""The Integrator's work on one PR from the merge queue (agent-integrator.yml runs it for each queued PR
in turn, so only one PR is being merged at any time):

  1. Checks the PR is still what the agents approved: the approved commit, or GitHub's clean merge of
     the base on top of it. Anything else goes back to review.
  2. If the base moved on, merges it in (update-branch) and records the result as approved: the PR's
     own changes are unchanged. With qa_on_update, the queue waits while QA tests the combined code.
  3. Waits for the required checks on that exact commit.
  4. With qa_in_queue: unless QA already passed these own changes, the queue waits while QA tests
     exactly that commit. Nothing else merges meanwhile, so QA runs once per PR, on the code that lands.
  5. If the base moved meanwhile (a human merged something), goes back to 2. Otherwise merges exactly
     that commit, so what lands is what CI (and QA) tested.

Conflicts and red checks go to the Implementor, timeouts and failed merges to the back of the queue.
Red checks, timeouts and failed merges are failed attempts: after max_attempts since the last Lead
decision, the Lead decides. Conflicts don't count: they come from other PRs' merges.

The result is one of: merged, bounced (to the Implementor), requeued (back of the queue), left (no
longer in the queue: closed, draft, new commits, label removed, QA didn't pass), lead.
"""

from __future__ import annotations

import contextlib
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from typing import Literal

from agentflow import config, markers, overlap, prs, queue
from agentflow.clock import Clock, SystemClock
from agentflow.config import Settings
from agentflow.github import GhError, GitHub
from agentflow.states import progress, transition

Result = Literal["merged", "bounced", "requeued", "left", "lead"]
METHODS = ("squash", "merge", "rebase")
STOPS_QA = ("agent:changes-requested", "agent:fixing", "agent:needs-decision", "agent:needs-human", "agent:review")


@dataclass(frozen=True)
class Config:
    required: str = "CI"  # AGENT_REQUIRED_CHECKS: workflow names, optionally path-scoped (prs.required_checks)
    qa_in_queue: bool = False  # QA once, at the front of the queue
    qa_on_update: bool = False  # QA after every update with the base
    qa_paths: str = ""  # QA only for PRs that change these paths (prefix|prefix)
    max_attempts: int = 3
    checks_minutes: int = 30
    qa_minutes: int = 60
    method: str = "squash"
    high_risk_ok: bool = False  # AGENT_AUTO_MERGE_HIGH_RISK
    protected: tuple[str, ...] = (".github/", "scripts/", "templates/")  # a human merges PRs that change these
    production_url: str = ""  # linked in the issue's progress note after the merge
    conflict_wait_minutes: int = 120
    conflict_ignore: str = overlap.DEFAULT_IGNORE
    avoid_conflicts: bool = True

    @classmethod
    def from_env(cls, env: Mapping[str, str], warn: Callable[[str], None] = lambda _: None) -> Config:
        method = env.get("AGENT_MERGE_METHOD") or "squash"
        if method not in METHODS:
            warn(f"::warning::AGENT_MERGE_METHOD must be squash, merge or rebase, not '{method}': squash-merging")
            method = "squash"
        protected = env.get("AGENT_PROTECTED_PATHS") or ".github/,scripts/,templates/"
        return cls(
            required=env.get("AGENT_REQUIRED_CHECKS") or "CI",
            qa_in_queue=env.get("AGENT_QA_IN_QUEUE") == "true",
            qa_on_update=env.get("AGENT_QA_ON_BASE_UPDATE") == "true",
            qa_paths=env.get("AGENT_QA_PATHS", ""),
            max_attempts=config.number(env, "AGENT_INTEGRATOR_MAX_ATTEMPTS", 3),
            checks_minutes=config.number(env, "AGENT_INTEGRATOR_CHECKS_MINUTES", 30),
            qa_minutes=config.number(env, "AGENT_INTEGRATOR_QA_MINUTES", 60),
            method=method,
            high_risk_ok=env.get("AGENT_AUTO_MERGE_HIGH_RISK") == "true",
            protected=tuple(p.strip() for p in protected.split(",") if p.strip()),
            production_url=config.link(env, "production", "", env["GITHUB_REPOSITORY"]) if env.get("GITHUB_REPOSITORY") else "",
            conflict_wait_minutes=config.number(env, "AGENT_CONFLICT_WAIT_MINUTES", 120),
            conflict_ignore=env.get("AGENT_CONFLICT_IGNORE") or overlap.DEFAULT_IGNORE,
            avoid_conflicts=env.get("AGENT_AVOID_CONFLICTS") != "false",
        )


class _Finish(Exception):
    def __init__(self, result: Result) -> None:
        super().__init__(result)
        self.result = result


@dataclass
class _Integration:
    gh: GitHub
    s: Settings
    pr: int
    cfg: Config
    clock: Clock
    log: Callable[[str], None]
    refresh_token: Callable[[], None]
    base: str = ""
    issue: int | None = None
    required: str = ""
    recovering: bool = False  # after an unexpected error: GitHub errors no longer stop the run
    _pending: list[str] = field(default_factory=list)

    # --- small steps ---------------------------------------------------------------------------------
    def say(self, body: str) -> None:
        self._quietly(self.gh.comment, self.pr, body)

    def note(self, line: str) -> None:
        progress(self.gh, self.s, line, pr=self.pr)

    def move(self, label: str | None, number: int | None = None) -> None:
        self._quietly(transition, self.gh, self.s, self.pr if number is None else number, label)

    def _quietly(self, fn: Callable[..., object], *args: object) -> None:
        if self.recovering:
            with contextlib.suppress(GhError):
                fn(*args)
        else:
            fn(*args)

    def finish(self, result: Result) -> None:
        self.log(f"#{self.pr}: result: {result}")
        raise _Finish(result)

    def approve_commit(self, sha: str, message: str) -> None:
        """Records a commit the Integrator made (or accepted) as approved: it leaves the PR's own changes as they were."""
        self.say(f"<!-- agent:integrator -->\n{message}\n\n<!-- agent:approved-sha {sha} -->")

    def still_ours(self, sha: str, label: str) -> bool:
        """Open, not a draft, at `sha`, still carrying `label`: nobody else changed it."""
        try:
            v = self.gh.pr(self.pr)
        except GhError:
            return False
        return v.is_open and not v.is_draft and v.head_sha == sha and label in v.labels

    def leave_if_draft(self) -> None:
        """Drafts are how humans pause the agents: a PR that became one leaves the queue (not a failure)."""
        try:
            v = self.gh.pr(self.pr)
        except GhError:
            return
        if v.is_open and v.is_draft:
            self.move(None)
            self.say(
                f"⏸️ **Merge queue:** #{self.pr} is a draft now, so it leaves the queue. "
                "Mark it ready for review to send it through review and back into the queue."
            )
            self.finish("left")

    def mergeable(self) -> str:
        state = "UNKNOWN"
        for _ in range(6):
            with contextlib.suppress(GhError):
                state = self.gh.pr_mergeable(self.pr)
            if state != "UNKNOWN":
                break
            self.clock.sleep(10)
        return state

    def behind(self, sha: str) -> int:
        return self.gh.behind_by(sha, self.base)

    # --- failures ------------------------------------------------------------------------------------
    def failures(self) -> int:
        """Failed attempts (`agent:integration-failed` comments) since the latest Lead decision."""
        try:
            mine = markers.from_bot(self.gh.comments(self.pr), self.s.bot)
        except GhError:
            return 0
        last_lead = markers.last_index(mine, markers.tag("lead"))
        return sum(1 for c in mine[last_lead + 1 :] if markers.tag("integration-failed") in c.body)

    def settle_if_closed(self) -> None:
        """Merged after all (e.g. an API error right after the merge) or closed: done, not failed."""
        try:
            state = self.gh.pr(self.pr).state
        except GhError:
            return
        if state == "MERGED":
            with contextlib.suppress(GhError):
                transition(self.gh, self.s, self.pr, "agent:done")
            if self.issue:
                with contextlib.suppress(GhError):
                    transition(self.gh, self.s, self.issue, "agent:done")
            self.finish("merged")
        if state == "CLOSED":
            with contextlib.suppress(GhError):
                transition(self.gh, self.s, self.pr, None)
            self.finish("left")

    def fail(self, kind: Literal["bounce", "requeue"], reason: str, todo: str = "") -> None:
        self.settle_if_closed()
        used = self.failures() + 1
        pr, most = self.pr, self.cfg.max_attempts
        if used >= most:
            self.move("agent:needs-decision")
            self.say(
                f"<!-- agent:integration-failed -->\n🛑 **Merge queue:** {reason}. That's {used} failed merge attempts since the last "
                f"Lead decision, so #{pr} leaves the queue. Lead, please decide."
            )
            self.note(f"🚦 **Merge queue**: #{pr} failed {used} merge attempts, handed to the Lead")
            self.finish("lead")
        if kind == "bounce":
            self.move("agent:changes-requested")
            self.say(
                f"<!-- agent:merge -->\n<!-- agent:integration-failed -->\n❌ **Merge queue:** {reason}. #{pr} leaves the queue "
                f"(failed attempt {used} of {most}). Implementor: {todo}"
            )
            self.note(f"🚦 **Merge queue**: {reason} on #{pr}, back to the Implementor")
            self.finish("bounced")
        # A new admission marker puts it at the back of the queue; re-applying agent:queued starts the
        # Integrator run that picks it up (this run handles each PR only once).
        self.say(
            f"<!-- agent:queued -->\n<!-- agent:integration-failed -->\n⏳ **Merge queue:** {reason}. #{pr} goes to the back of the "
            f"queue (failed attempt {used} of {most})."
        )
        self.move("agent:queued")
        self.note(f"🚦 **Merge queue**: {reason} on #{pr}, back of the queue")
        self.finish("requeued")

    def conflict(self, what: str) -> None:
        """A conflict with the base: the Implementor resolves it. Not a failed attempt."""
        pr, base = self.pr, self.base
        self.move("agent:changes-requested")
        self.say(
            f"<!-- agent:merge -->\n⚠️ **Merge queue:** {what}, so #{pr} leaves the queue. Implementor: run `git fetch origin {base}` and "
            f"`git merge origin/{base}`, resolve the conflicts keeping the intent of both changes, run all checks, and push. Where you can, "
            "leave this PR's own edits as they were: then the re-review only has to look at the resolution."
        )
        self.note(f"🚦 **Merge queue**: #{pr} conflicts with `{base}`, back to the Implementor")
        self.finish("bounced")

    # --- waiting -------------------------------------------------------------------------------------
    def wait_checks(self, sha: str) -> tuple[str, str]:
        """(pass | fail | timeout | missing | moved, the failed checks as links). missing: none of the
        required checks ever appeared (a configuration problem); moved: the PR changed meanwhile."""
        if not self.required:
            self.log(f"#{self.pr}: no required check applies to the paths this PR changes")
            return "pass", ""
        wanted = [w.strip() for w in self.required.split(",")]
        deadline = self.clock.now() + self.cfg.checks_minutes * 60
        seen = False
        while self.clock.now() < deadline:
            self.refresh_token()
            if not self.still_ours(sha, "agent:integrating"):
                return "moved", ""
            checks = [c for c in self.gh.pr_checks(self.pr) if c.workflow in wanted]
            failed = ", ".join(f"[{c.name}]({c.link})" for c in checks if c.bucket in ("fail", "cancel"))
            seen = seen or bool(checks)
            if failed:
                return "fail", failed
            if checks and not any(c.bucket == "pending" for c in checks):
                return "pass", ""
            self.clock.sleep(30)
        return ("timeout" if seen else "missing"), ""

    def hold_for_qa(self, sha: str, why: str) -> None:
        """QA tests `sha` while the queue waits. QA's pass goes through the merge gate, which sees the hold
        marker and hands the PR back as agent:integrating. Returns then, finishes otherwise."""
        self.say(f"<!-- agent:integrator-hold {sha} -->\n🧪 **Merge queue:** {why} QA tests `{sha[:7]}` now, and the queue waits for its verdict.")
        self.move("agent:qa")
        self.note(f"🚦 **Merge queue**: QA tests #{self.pr} at the front of the queue, the queue waits")
        deadline = self.clock.now() + self.cfg.qa_minutes * 60
        while self.clock.now() < deadline:
            self.clock.sleep(30)
            self.refresh_token()
            v = self.gh.pr(self.pr)
            if not v.is_open or v.head_sha != sha:
                self.log(f"#{self.pr}: changed while QA was testing")
                self.finish("left")
            if "agent:integrating" in v.labels:
                # Only a recorded pass counts: the label may be left over (e.g. a failed label change).
                if prs.qa_passed(self.gh, self.s, self.pr, sha):
                    return
                self.log(f"#{self.pr}: agent:integrating, but no QA pass for {sha[:7]} yet")
            elif any(label in STOPS_QA for label in v.labels):
                self.log(f"#{self.pr}: QA did not pass (labels: {','.join(v.labels)})")
                self.finish("left")
        self.say(f"⏳ **Merge queue:** QA didn't finish within {self.cfg.qa_minutes} minutes, so the queue moves on. #{self.pr} rejoins it when QA passes.")
        self.finish("left")

    # --- the run -------------------------------------------------------------------------------------
    def admit(self) -> str:
        """Is it still in the queue? Takes it (agent:integrating) and returns its head, or finishes."""
        pr = self.pr
        self.refresh_token()
        v = self.gh.pr(pr)
        self.base, self.issue = v.base_ref, self.gh.pr_closing_issue(pr)
        if v.state == "MERGED":
            self.move("agent:done")
            self.finish("left")
        if not v.is_open:
            self.finish("left")
        if "agent:queued" not in v.labels and "agent:integrating" not in v.labels:
            self.log(f"#{pr}: no longer queued")
            self.finish("left")
        self.leave_if_draft()
        self.move("agent:integrating")
        self.log(f"#{pr}: integrating {v.head_sha[:7]} into {self.base}")
        return v.head_sha

    def qa_applies(self) -> bool:
        """QA in the queue only for PRs that change AGENT_QA_PATHS (when set)."""
        if not (self.cfg.qa_in_queue and self.cfg.qa_paths):
            return True
        try:
            applies = prs.touches(self.gh, self.pr, self.cfg.qa_paths)
        except GhError:
            self.fail("requeue", f"couldn't read the files #{self.pr} changes")
        if not applies:
            self.log(f"#{self.pr}: changes nothing under AGENT_QA_PATHS ({self.cfg.qa_paths}): no QA")
        return applies

    def leave_if_changed(self, head: str, when: str) -> None:
        if not self.still_ours(head, "agent:integrating"):
            self.leave_if_draft()
            self.log(f"#{self.pr}: the PR changed {when}")
            self.finish("left")

    def run(self) -> None:
        pr = self.pr
        head = self.admit()
        self.check_approval(head)
        self.check_allowed()
        self.required = ",".join(prs.required_checks(self.gh, pr, self.cfg.required))
        qa_applies = self.qa_applies()
        for _ in range(3):  # 2.-5., repeated only if the base moves outside the queue
            self.leave_if_changed(head, "or left the queue")
            if self.mergeable() == "CONFLICTING":
                self.conflict(f"#{pr} conflicts with `{self.base}`")
            head, updated = self.update(head)
            self.test(head, updated)
            if self.cfg.qa_in_queue and qa_applies and not prs.qa_passed(self.gh, self.s, pr, head):
                self.hold_for_qa(head, f"The required checks passed on #{pr}{updated}, so it can merge.")
            # Right before the merge (nothing slow in between: a human can still merge by hand meanwhile).
            if self.behind(head) > 0:
                self.log(f"#{pr}: {self.base} moved while the checks (or QA) ran, updating again")
                continue
            if self.merge(head):
                self.finish("merged")
            # New commits (refused by --match-head-commit) or a closed PR: not a failed attempt.
            self.leave_if_changed(head, "while merging")
            if self.behind(head) > 0:
                continue
            self.fail("requeue", f"the merge failed: {self._merge_error.splitlines()[-1] if self._merge_error else ''}")
        self.fail("requeue", f"`{self.base}` kept moving while #{pr} was being tested")

    def check_approval(self, head: str) -> None:
        """1. Still exactly what was approved?"""
        pr, base = self.pr, self.base
        approved = prs.approved_sha(self.gh, self.s, pr)
        if head == approved:
            return
        if approved and prs.clean_base_update(self.gh, self.s, pr, head):
            self.approve_commit(
                head,
                f"🔄 **Merge queue:** `{head[:7]}` is GitHub's clean merge of `{base}` into the approved `{approved[:7]}`, "
                f"so #{pr}'s own changes are as approved.",
            )
            return
        self.move("agent:review")
        what = f"the agents approved `{approved[:7]}`, but the head is now `{head[:7]}`" if approved else f"no recorded approval for `{head[:7]}`"
        self.say(f"🔁 **Merge queue:** {what}. Sending it through review again.")
        self.note(f"🚦 **Merge queue**: head of #{pr} moved after approval, back to review")
        self.finish("left")

    def check_allowed(self) -> None:
        """Still allowed to merge without a human? The merge gate checked at approval, but the issue's risk
        can be raised since (a human adds risk:high), and the protected paths are checked again."""
        pr = self.pr
        if self.issue and not self.cfg.high_risk_ok and "risk:high" in self.gh.labels(self.issue):
            self.move("agent:needs-human")
            self.say(f"✋ **Merge queue:** #{self.issue} is now **high risk**, so a human merges #{pr}. It leaves the queue.")
            self.note(f"🚦 **Merge queue**: #{pr} is high risk now, a human merges it")
            self.finish("left")
        touched = [f for f in self.gh.pr_files(pr) if f.startswith(self.cfg.protected)]
        if touched:
            self.move("agent:needs-human")
            listing = "\n".join(f"- `{f}`" for f in touched)
            self.say(f"✋ **Merge queue:** #{pr} changes the agent team's own tooling, so a human merges it:\n{listing}")
            self.finish("left")

    def update(self, head: str) -> tuple[str, str]:
        """2. Brings the PR up to date with the base. Returns the head to test and a note for messages."""
        pr, base = self.pr, self.base
        n_behind = self.behind(head)
        if n_behind <= 0:
            return head, ""
        self.log(f"#{pr}: behind {base} by {n_behind}, updating")
        try:
            self.gh.update_branch(pr, head)
        except GhError:
            if self.mergeable() == "CONFLICTING":
                self.conflict(f"#{pr} conflicts with `{base}`")
            # Refused without a conflict: usually because the base changed workflow files, which the App may
            # not push (no Workflows permission, by design). One retry first, in case it was a passing error.
            self.clock.sleep(10)
            try:
                self.gh.update_branch(pr, head)
            except GhError as e:
                self.move("agent:needs-human")
                last = str(e).splitlines()[-1] if str(e) else ""
                self.say(
                    f"✋ **Merge queue:** GitHub refused to merge `{base}` into #{pr} although they don't conflict, most likely because "
                    f"`{base}` changed workflow files, which the agents' App may not push. A human: merge `{base}` into this branch "
                    f"(`git merge origin/{base}`, push), then apply `agent:approved`.\n> {last}"
                )
                self.note(f"🚦 **Merge queue**: `{base}` can't be merged into #{pr} by the agents (workflow files?), a human must")
                self.finish("left")
        new = head
        for _ in range(30):
            self.clock.sleep(4)
            new = self.gh.pr(pr).head_sha
            if new != head:
                break
        if new == head:
            self.fail("requeue", "updating the branch didn't produce a new commit in time")
        if not prs.clean_base_update(self.gh, self.s, pr, new):
            # Not our merge commit: someone pushed at the same moment.
            self.move("agent:review")
            self.say(f"🔁 **Merge queue:** #{pr} got new commits while it was being updated. Sending it through review again.")
            self.finish("left")
        tested = "QA and CI test" if self.cfg.qa_on_update else "CI tests"
        later = " QA tests it then, unless it already passed these changes." if self.cfg.qa_in_queue else ""
        self.approve_commit(
            new,
            f"🔄 **Merge queue:** merged `{base}` ({n_behind} new commit(s)) into #{pr}. Its own changes are unchanged, so it isn't "
            f"reviewed again. {tested} the combined code before it merges.{later}",
        )
        self.note(f"🚦 **Merge queue**: brought #{pr} up to date with `{base}`, testing the combined code")
        if self.cfg.qa_on_update:
            self.hold_for_qa(new, f"This is the combined code with the latest `{base}` (`AGENT_QA_ON_BASE_UPDATE`).")
        return new, f" (the combined code with the latest `{base}`)"

    def test(self, head: str, updated: str) -> None:
        """3. The required checks on exactly that commit."""
        pr, base = self.pr, self.base
        outcome, failed = self.wait_checks(head)
        if outcome == "moved":
            self.leave_if_draft()
            self.log(f"#{pr}: the PR changed while its checks ran")
            self.finish("left")
        if outcome == "fail":
            self.fail(
                "bounce",
                f"required checks failed on `{head[:7]}`{updated}: {failed}",
                f"open the failing check and reproduce it locally. If it only fails together with the latest `{base}`, run "
                f"`git fetch origin {base}` and `git merge origin/{base}` first. Fix it, run all checks, and push.",
            )
        if outcome == "timeout":
            self.fail("requeue", f"the required checks ({self.required}) didn't finish within {self.cfg.checks_minutes} minutes")
        if outcome == "missing":
            # No agent can fix this, and retrying every PR would only burn reviews and Lead decisions.
            self.move("agent:needs-human")
            self.say(
                f"🛑 **Merge queue:** none of the required checks (`AGENT_REQUIRED_CHECKS` = `{self.required}`) reported on `{head[:7]}` "
                f"within {self.cfg.checks_minutes} minutes. Check that variable against the workflow names in the PR's checks, then apply "
                "`agent:approved` again."
            )
            self.note(f"🚦 **Merge queue**: no required check reported on #{pr}, a human must check `AGENT_REQUIRED_CHECKS`")
            self.finish("left")

    _merge_error: str = ""

    def merge(self, head: str) -> bool:
        """5. Merges exactly `head`. gh can report an error after the merge itself succeeded (e.g. deleting
        the branch failed), so the PR's state decides, not gh's exit code."""
        self.refresh_token()
        self._merge_error = self.gh.merge(self.pr, self.cfg.method, head)
        if self.gh.pr(self.pr).state != "MERGED":
            self.log(f"#{self.pr}: merge failed: {self._merge_error}")
            return False
        transition(self.gh, self.s, self.pr, "agent:done")
        if self.issue:
            transition(self.gh, self.s, self.issue, "agent:done")
            deploying = f", deploying to [production]({self.cfg.production_url})" if self.cfg.production_url else ""
            progress(self.gh, self.s, f"✅ **Merged** #{self.pr}{deploying}", issue=self.issue)
        for line in queue.sweep_conflicts(self.gh, self.s, self.pr, self.base, self.clock):
            self.log(line)
        if self.cfg.avoid_conflicts:  # issues that waited for this PR's files can start now
            for line in overlap.release_waiting(self.gh, self.s, self.cfg.conflict_wait_minutes, self.cfg.conflict_ignore, self.clock):
                self.log(line)
        return True


def integrate(
    gh: GitHub,
    s: Settings,
    pr: int,
    cfg: Config,
    *,
    clock: Clock | None = None,
    log: Callable[[str], None],
    refresh_token: Callable[[], None] = lambda: None,
) -> Result:
    """Integrates one queued PR (see the module docs) and returns the result."""
    job = _Integration(gh, s, pr, cfg, clock or SystemClock(), log, refresh_token)
    try:
        job.run()
    except _Finish as f:
        return f.result
    except (GhError, ValueError, KeyError) as e:
        # Never leave the PR stuck in agent:integrating: back of the queue, whatever else fails now.
        log(f"#{pr}: unexpected error: {e}")
        job.recovering = True
        try:
            job.fail("requeue", f"the Integrator hit an unexpected error ([run log]({s.run_url}))")
        except _Finish as f:
            return f.result
    raise AssertionError("the Integrator finished without a result")
