"""The PR-side steps around the agents: the Reviewer's and QA's guards (is this run still worth doing,
and how many rounds were there) and what their verdicts lead to, QA's waits for CI and the preview,
the Lead's budget and decision, and the merge gate that admits approved PRs to the merge queue."""

from __future__ import annotations

import contextlib
import os
import re
from dataclasses import dataclass

from agentflow import issues, markers, prs, queue
from agentflow.clock import Clock, SystemClock
from agentflow.config import Settings
from agentflow.github import GhError, GitHub
from agentflow.production import curl
from agentflow.roles import ignore_scratch, move
from agentflow.states import progress
from agentflow.step import StepIO, field_of, posted, result, run_log

APPROVE = re.compile(r"\*\*Verdict:\*\*\s*approve")
PASS = re.compile(r"\*\*Verdict:\*\*\s*pass")


def rounds(gh: GitHub, s: Settings, pr: int, role: str, success: re.Pattern[str]) -> tuple[int, int, int]:
    """(all of the role's reports, reports since the latest Lead decision, unsuccessful ones since then).
    Only unsuccessful rounds count toward the budget: re-runs after base updates are not a loop, and a Lead
    ruling gives the loop a fresh budget."""
    mine = markers.from_bot(gh.comments(pr), s.bot)
    tag = markers.tag(role)
    since = [c for c in mine[markers.last_index(mine, markers.tag("lead")) + 1 :] if tag in c.body]
    return sum(1 for c in mine if tag in c.body), len(since), sum(1 for c in since if not success.search(c.body))


def _quiet(fn: object, *args: object) -> str | None:
    """A check whose failure means "no" (as a failed command in a bash `if` did)."""
    try:
        return fn(*args)  # type: ignore[operator, no-any-return]
    except GhError:
        return None


# --- the Reviewer ------------------------------------------------------------------------------------
@dataclass(frozen=True)
class QaRules:
    in_review: bool = False  # AGENT_QA with AGENT_QA_STAGE=review: QA after the review
    on_base_update: bool = False  # AGENT_QA_ON_BASE_UPDATE
    in_queue: bool = False  # QA at the front of the merge queue (the default stage)
    paths: str = ""  # AGENT_QA_PATHS


def _skip_after_base_merge(gh: GitHub, s: Settings, io: StepIO, pr: int, *, head: str, qa: QaRules, why: str) -> None:
    if qa.in_review and qa.on_base_update:
        move(gh, s, io, pr, "agent:qa")
        skipped = "re-review skipped, sent to QA"
    else:
        io.say(prs.approve(gh, s, pr, head, "reviewer"))
        skipped = "re-review and QA skipped, CI decides" if qa.in_review else "re-review skipped, CI decides"
    progress(gh, s, f"🧐 **Reviewer**: {why}, {skipped}", pr=pr)
    io.output(stop="true")


def reviewer_guard(gh: GitHub, s: Settings, io: StepIO, pr: int, *, head: str, action: str, qa: QaRules, skip_same: bool, max_rounds: int) -> None:
    os.makedirs(".agent-out", exist_ok=True)
    # A queued run may be stale by now (new commits, merge-gate verdict, conflict): don't spend a round on it.
    skip = prs.still_current(gh, s, pr, head)
    if skip:
        io.tell(f"Skipped review: {skip}")
        io.output(stop="true")
        return
    if action == "synchronize":
        # The Integrator records its own updates as approved: a push of an approved commit needs no review.
        if head == prs.approved_sha(gh, s, pr):
            io.tell("Skipped review: this commit is already approved (the merge queue's update)")
            io.output(stop="true")
            return
        # A clean merge of the base into an approved PR: its own changes are exactly what was approved.
        approved = _quiet(prs.clean_base_update, gh, s, pr, head)
        if approved:
            io.tell(f"Skipped review: only a clean merge of the base on top of approved {approved[:7]}")
            _skip_after_base_merge(gh, s, io, pr, head=head, qa=qa, why="only the base branch was merged in since the approved commit")
            return
        # Someone pushed since the approval (usually the Implementor resolving a conflict). If the PR's own
        # edits are exactly the approved ones, only the base changed around them; otherwise the Reviewer
        # gets how they changed.
        interdiff = ".agent-out/interdiff.diff"
        approved = _quiet(prs.same_own_changes, gh, s, pr, head, interdiff)
        if approved and skip_same:
            io.tell(f"Skipped review: the PR's own edits are unchanged since approved {approved[:7]}")
            qa_next = qa.in_review and qa.on_base_update
            then = "QA tests the combined code next." if qa_next else "CI tests the combined code before it merges."
            # The comment comes first: approve records the approved commit in the latest Reviewer comment.
            gh.comment(
                pr,
                f"<!-- agent:reviewer -->\n## 🧐 Reviewer\n\n**Verdict:** approve\n\nSince the approved `{approved[:7]}`, only the base branch "
                "was merged in: this PR's own added and removed lines are exactly the ones that were approved, so they aren't reviewed again "
                f"(`AGENT_SKIP_REVIEW_ON_SAME_CHANGES`). {then}",
            )
            _skip_after_base_merge(gh, s, io, pr, head=head, qa=qa, why="own edits unchanged since the approval")
            return
        if not approved and os.path.isfile(interdiff) and os.path.getsize(interdiff) > 0:
            io.output(interdiff=interdiff, approved=prs.approved_sha(gh, s, pr) or "")
    total, since, rejected = rounds(gh, s, pr, "reviewer", APPROVE)
    io.output(total=total, round=since + 1)
    if rejected >= max_rounds:
        move(gh, s, io, pr, "agent:needs-decision")
        gh.comment(pr, f"🛑 {max_rounds} review rounds without approval. Handing to the Lead.")
        io.output(stop="true")


def _qa_applies(gh: GitHub, pr: int, qa: QaRules) -> QaRules:
    """AGENT_QA_PATHS: only PRs that change those paths go through browser QA. Only a clear "no" skips QA."""
    if (qa.in_review or qa.in_queue) and qa.paths:
        with contextlib.suppress(GhError):
            if not prs.touches(gh, pr, qa.paths):
                return QaRules(on_base_update=qa.on_base_update, paths=qa.paths)
    return qa


def reviewer_apply(gh: GitHub, s: Settings, io: StepIO, pr: int, *, head: str, raw: str, total: int, round_: int, qa: QaRules) -> None:
    qa = _qa_applies(gh, pr, qa)
    verdict = field_of(result(raw), "verdict", "error")
    if not posted(gh, s, pr, "reviewer", total):
        io.warn(f"Reviewer returned '{verdict}' but posted no summary comment")
        verdict = "missing-comment"
    # A run without a usable verdict usually just slipped: retry once per commit before the Lead spends a decision.
    if verdict not in ("approve", "request-changes", "needs-human"):
        retry = f"<!-- agent:reviewer-retry {head} -->"
        if not prs.still_current(gh, s, pr, head) and not any(retry in c.body for c in gh.comments(pr)):
            gh.comment(pr, f"{retry}\n🔁 The Reviewer run ended without a review ({verdict}, {run_log(s)}). Retrying once.")
            move(gh, s, io, pr, "agent:review")
            return
    # The PR may have changed while the agent worked. Never apply a verdict on top of that.
    stale = prs.still_current(gh, s, pr, head)
    if stale:
        io.tell(f"Verdict '{verdict}' not applied: {stale}")
        progress(gh, s, f"🧐 **Reviewer** (round {round_}): verdict not applied, {stale}", pr=pr)
        return
    if verdict == "approve":
        if qa.in_review:
            move(gh, s, io, pr, "agent:qa")
        else:
            io.say(prs.approve(gh, s, pr, head, "reviewer"))
        msg = "approved" + (", sent to QA" if qa.in_review else "") + (", QA tests it at the front of the merge queue" if qa.in_queue else "")
    elif verdict == "request-changes":
        move(gh, s, io, pr, "agent:changes-requested")
        msg = "requested changes"
    else:
        move(gh, s, io, pr, "agent:needs-decision")
        if verdict != "needs-human":
            gh.comment(pr, f"⚠️ Reviewer agent failed ({run_log(s)}). Handing to the Lead.")
        msg = "unsure or failed, handed to the Lead"
    progress(gh, s, f"🧐 **Reviewer** (round {round_}): {msg} on #{pr}", pr=pr)


# --- QA ----------------------------------------------------------------------------------------------
def qa_guard(gh: GitHub, s: Settings, io: StepIO, pr: int, *, head: str, url_template: str, local_url: str | None, max_rounds: int) -> None:
    """local_url: the app QA starts on the runner (AGENT_PREVIEW_URL=none), else the preview's URL template."""
    os.makedirs(".agent-out/screenshots", exist_ok=True)
    ignore_scratch(".agent-out/", ".agent-trusted/", ".gh-pages/")
    skip = prs.still_current(gh, s, pr, head, "agent:qa")
    if skip:
        io.tell(f"Skipped QA: {skip}")
        io.output(stop="true")
        return
    url = local_url if local_url is not None else url_template.replace("{owner}", s.owner).replace("{repo}", s.name).replace("{pr}", str(pr))
    io.output(url=url)
    total, since, failed = rounds(gh, s, pr, "qa", PASS)
    io.output(total=total, round=since + 1)
    if failed >= max_rounds:
        move(gh, s, io, pr, "agent:needs-decision")
        gh.comment(pr, f"🛑 {max_rounds} QA rounds without a pass. Handing to the Lead.")
        io.output(stop="true")


def qa_wait_checks(gh: GitHub, s: Settings, io: StepIO, pr: int, *, required_spec: str, clock: Clock | None = None) -> None:
    """The same rules as the merge queue (only the required workflows for the files the PR changes), for
    up to 25 minutes. On a timeout QA runs anyway: the merge queue still waits for the checks."""
    clock = clock or SystemClock()
    required = ",".join(prs.required_checks(gh, pr, required_spec))
    if not required:
        io.output(result="pass")
        return
    for _ in range(50):
        state, failed = prs.evaluate_checks(gh.pr_checks(pr), required)
        if state == "fail":
            io.output(result="fail", failed=failed)
            return
        if state == "pass":
            io.output(result="pass")
            return
        clock.sleep(30)
    io.output(result="timeout")


def qa_wait_preview(io: StepIO, gh: GitHub, *, head: str, url: str, environment: str, clock: Clock | None = None) -> None:
    """Waits for the preview of exactly this commit. AGENT_PREVIEW_URL=deployment: whatever deployment of
    it reports success (optionally only in AGENT_PREVIEW_ENVIRONMENT), its environment_url. Otherwise the
    preview serves version.txt with the commit it was built from."""
    clock = clock or SystemClock()
    if url == "deployment":
        for _ in range(80):
            found: list[str] = []
            with contextlib.suppress(GhError):
                found = gh.deployment_urls(head, environment)
            if found:
                io.output(url=found[0].rstrip("/") + "/", ready="true")
                return
            clock.sleep(15)
        io.warn(f"No successful deployment of {head}{f' in {environment}' if environment else ''} reported a URL")
        return
    live = ""
    for _ in range(60):
        live = "".join((curl(f"{url}version.txt?t={int(clock.now())}") or "").split())
        if live == head:
            io.output(url=url, ready="true")
            return
        clock.sleep(15)
    io.warn(f"Preview at {url} never served {head} (last seen: {live or 'nothing'})")


@dataclass(frozen=True)
class QaRun:
    """What the earlier QA steps found."""

    ready: bool  # the preview (or the local app) serves this commit
    ci_result: str  # pass, fail or timeout
    ci_failed: str
    url: str
    local: bool
    e2e_exit: str  # 0, none (no suite) or the suite's exit code


def qa_apply(gh: GitHub, s: Settings, io: StepIO, pr: int, *, head: str, raw: str, total: int, round_: int, run: QaRun) -> None:
    if run.ci_result == "fail":
        stale = prs.still_current(gh, s, pr, head, "agent:qa")
        if stale:
            io.tell(f"CI failed, but {stale}")
            return
        move(gh, s, io, pr, "agent:changes-requested")
        gh.comment(
            pr,
            f"<!-- agent:merge -->\n❌ Required checks failed on `{head[:7]}`: {run.ci_failed}. QA was skipped, since this commit can't merge. "
            "Implementor: open the failing check, reproduce it locally, fix it, and run all checks again before pushing.",
        )
        progress(gh, s, f"🧪 **QA**: skipped, required checks failed on #{pr}, back to the Implementor", pr=pr)
        return
    if not run.ready:
        move(gh, s, io, pr, "agent:needs-decision")
        if run.local:
            gh.comment(
                pr,
                f"⚠️ QA could not start: the app never answered at {run.url} on the runner (`AGENT_QA_START_COMMAND`, see the "
                f"{run_log(s)}). Handing to the Lead.",
            )
        else:
            gh.comment(pr, f"⚠️ QA could not start: the preview at {run.url} never served commit `{head[:7]}`. Check the Preview workflow. Handing to the Lead.")
        return
    verdict = field_of(result(raw), "verdict", "error")
    if not posted(gh, s, pr, "qa", total):
        io.warn(f"QA returned '{verdict}' but posted no report")
        verdict = "missing-comment"
    stale = prs.still_current(gh, s, pr, head, "agent:qa")
    if stale:
        io.tell(f"Verdict '{verdict}' not applied: {stale}")
        progress(gh, s, f"🧪 **QA** (round {round_}): verdict not applied, {stale}", pr=pr)
        return
    if verdict == "pass":
        io.say(prs.approve(gh, s, pr, head, "qa"))
    elif verdict == "fail":
        move(gh, s, io, pr, "agent:changes-requested")
    else:
        move(gh, s, io, pr, "agent:needs-decision")
        if verdict != "needs-human":
            gh.comment(pr, f"⚠️ QA agent failed ({run_log(s)}). Handing to the Lead.")
    e2e = {"0": "e2e green", "none": "no e2e suite"}.get(run.e2e_exit, "e2e failing")
    msg = {"pass": f"passed · {e2e} · screenshots on #{pr}", "fail": f"found defects · {e2e} · details and screenshots on #{pr}"}.get(
        verdict, "could not decide, handed to the Lead"
    )
    progress(gh, s, f"🧪 **QA** (round {round_}): {msg}", pr=pr)


# --- the Lead ------------------------------------------------------------------------------------------
def lead_guard(gh: GitHub, s: Settings, io: StepIO, n: int, *, kind: str, max_decisions: int, split_enabled: bool, max_depth: int) -> None:
    """The Lead's budget (decisions since the last escalation), and whether it may split the issue."""
    ignore_scratch(".agent-out/", ".agent-trusted/")
    used = issues.lead_budget(gh, s, n)
    io.output(used=used, total=markers.count(gh.comments(n), s.bot, "lead"))
    if kind == "issue":
        mode = issues.split_mode(gh, s, n, enabled=split_enabled, max_depth=max_depth)
        if mode.kind == "not-allowed":
            io.output(split="not-allowed", split_text=f"not possible ({mode.reason})")
        else:
            io.output(split="allowed", split_text="possible, choose `split` if the work is too big for one Implementor run or one reviewable PR")
    if used >= max_decisions:
        move(gh, s, io, n, "agent:needs-human")
        gh.comment(n, f"🛑 Lead has already made {used} decisions here without resolving it. Escalating to a human.")
        io.output(stop="true")


ISSUE_ACTIONS = {"restart-analysis": "agent:start", "redesign": "agent:analyzed", "implement": "agent:ready"}
PR_ACTIONS = {"fix": "agent:changes-requested", "re-review": "agent:review", "qa": "agent:qa"}


def lead_apply(gh: GitHub, s: Settings, io: StepIO, n: int, *, kind: str, raw: str, total: int, split: str, head: str) -> None:
    res = result(raw)
    action, reason = field_of(res, "action", "error"), field_of(res, "rationale", "no rationale")
    if not posted(gh, s, n, "lead", total):
        io.warn(f"Lead returned '{action}' but posted no decision comment")
        action = "missing-comment"
    io.note(f"Lead decision on {kind} #{n}: {action} ({reason})")
    mapping = ISSUE_ACTIONS if kind == "issue" else PR_ACTIONS
    if action in mapping:
        move(gh, s, io, n, mapping[action])
    elif kind == "issue" and action == "split":
        if split == "allowed":
            gh.comment(
                n,
                "<!-- agent:split-required -->\n🧩 **The Lead asked for a split.** The Architect runs again and splits this issue into "
                "sub-issues (see the Lead's comment above).",
            )
            move(gh, s, io, n, "agent:analyzed")
        else:
            action = "escalate"
            move(gh, s, io, n, "agent:needs-human")
            gh.comment(n, "⚠️ Lead chose `split`, but this issue can't be split further. Escalating to a human.")
    elif kind == "issue" and action == "close":
        move(gh, s, io, n, "agent:out-of-scope")
        gh.close_issue(n, "not planned")
    elif kind == "pr" and action == "approve":
        io.say(prs.approve(gh, s, n, head, "lead"))
    elif kind == "pr" and action == "close":
        move(gh, s, io, n, None)
        gh.close_pr(n)
    elif action == "escalate":
        move(gh, s, io, n, "agent:needs-human")
    else:
        move(gh, s, io, n, "agent:needs-human")
        gh.comment(n, f"⚠️ Lead could not decide ('{action}', {run_log(s)}). Escalating to a human.")
    if kind == "issue":
        progress(gh, s, f"🧭 **Lead**: {action}", issue=n)
    else:
        progress(gh, s, f"🧭 **Lead** (on #{n}): {action}", pr=n)


# --- the merge gate ------------------------------------------------------------------------------------
@dataclass(frozen=True)
class Approval:
    sender_type: str  # "Bot" when the agents applied agent:approved, anything else for a human
    sender: str
    high_risk_ok: bool = False  # AGENT_AUTO_MERGE_HIGH_RISK
    protected: tuple[str, ...] = (".github/", "scripts/", "templates/")


def merge_risk_gate(gh: GitHub, s: Settings, io: StepIO, pr: int, *, head: str, by: Approval) -> None:
    """May this approved PR join the merge queue? Any open PR still at its approved commit may: high-risk
    ones too, which the Integrator tests and then hands to a human instead of merging."""
    view = gh.pr(pr)
    state = view.state + (" draft" if view.is_draft else "")
    if state != "OPEN":  # the approval may arrive late (a redelivered event, a human label)
        io.note(f"PR is {state} now: nothing to queue")
        io.output(stop="true")
        return
    # An agent approval names the exact commit it approved: anything pushed after it goes through review
    # again. A human applying the label is trusted.
    if by.sender_type == "Bot":
        approved = prs.approved_sha(gh, s, pr)
        if approved != head:
            io.note(f"Approval was for {approved or 'nothing'}, head is {head}")
            move(gh, s, io, pr, "agent:review")
            what = f"The agents approved `{approved[:7]}`, but the PR head is now `{head[:7]}`" if approved else f"No recorded agent approval for `{head[:7]}`"
            gh.comment(pr, f"🔁 {what}. Sending it through review again.")
            progress(gh, s, "🚦 **Merge gate**: head moved after approval, back to review", pr=pr)
            io.output(stop="true")
            return
    else:
        io.note(f"Approved by {by.sender}")
    issue = gh.pr_closing_issue(pr)
    risk = next((label.removeprefix("risk:") for label in gh.labels(issue) if label.startswith("risk:")), "unknown") if issue else "unknown"
    io.output(issue=issue or "")
    io.note(f"Linked issue: {issue or 'none'}, risk: {risk}")
    # High risk, or the team's own tooling (prompts, scripts, templates): a human merges, but only after the
    # queue has tested it like any other PR (update, checks, QA). The Integrator hands it over then.
    touched = [f for f in gh.pr_files(pr) if f.startswith(by.protected)]
    if (risk == "high" and not by.high_risk_ok) or touched:
        why = "it is high risk" if risk == "high" and not by.high_risk_ok else "it changes the agent team's own tooling"
        io.note(f"Joins the queue, but {why}: a human merges it once the queue has tested it")


def merge_join(gh: GitHub, s: Settings, io: StepIO, pr: int, *, head: str, base: str, sender_type: str) -> None:
    """Admits the PR to the merge queue (its place comes from this admission comment)."""
    # With AGENT_QA_ON_BASE_UPDATE the Integrator holds the queue while QA tests a PR it just updated.
    # QA's pass lands here: hand the PR straight back to the Integrator, keeping its place.
    hold = markers.latest_value(markers.from_bot(gh.comments(pr), s.bot), "integrator-hold", r"[0-9a-f]{40}")
    if hold == head:
        move(gh, s, io, pr, "agent:integrating")
        progress(gh, s, f"🚦 **Merge gate**: QA passed on the updated #{pr}, back to the Integrator", pr=pr)
        io.note("QA passed on the commit the Integrator is holding for: back to the Integrator")
        return
    ahead = sum(1 for n, _ in queue.order(gh, s) if n != pr)
    # A human approval also records the commit it approved, as an agent approval does.
    human = "" if sender_type == "Bot" else f"\n\n<!-- agent:approved-sha {head} -->"
    gh.comment(
        pr,
        f"<!-- agent:queued -->\n🚦 **Queued for merge** at position {ahead + 1}{f' ({ahead} PR(s) ahead)' if ahead else ''}. The Integrator merges "
        f"queued PRs one at a time: right before merging, it brings this PR up to date with `{base}` and waits for the required checks on exactly "
        f"that commit, so CI tests what lands. This PR's own changes are not reviewed again unless they change.{human}",
    )
    move(gh, s, io, pr, "agent:queued")
    progress(gh, s, f"🚦 **Merge gate**: #{pr} queued for merge (position {ahead + 1})", pr=pr)
    io.note(f"Queued at position {ahead + 1}")
