"""Review and approvals: which commit the agents approved, whether QA passed a PR's own changes, what
those changes are, and whether a queued Reviewer or QA run still has something worth doing."""

from __future__ import annotations

import difflib
import re

from agentflow import markers
from agentflow.clock import Clock, SystemClock
from agentflow.config import Settings
from agentflow.github import GhError, GitHub
from agentflow.model import Check, PullRequest
from agentflow.states import progress, transition

APPROVED = re.compile(r"<!-- agent:approved-sha ([0-9a-f]{40}) -->")
VERDICT_PASS = re.compile(r"\*\*Verdict:\*\*\s*pass")
MAX_COMPARE_FILES = 300  # GitHub's compare lists at most this many files; past it the diff is incomplete


def _approval(body: str) -> str | None:
    found = APPROVED.findall(body)
    return found[-1] if found else None


def approved_sha(gh: GitHub, s: Settings, pr: int) -> str | None:
    """The commit the agents last approved: the newest `<!-- agent:approved-sha <sha> -->` marker in the
    bot's comments (approve, the merge gate and the Integrator write it). Nobody else can forge one."""
    found = [sha for c in markers.from_bot(gh.comments(pr), s.bot) for sha in APPROVED.findall(c.body)]
    return found[-1] if found else None


def approve(gh: GitHub, s: Settings, pr: int, sha: str, role: str) -> str:
    """Approves a PR for the merge gate: records the approved commit in the approving role's latest
    comment (or a new one), then applies agent:approved. Only that commit gets queued and merged, so
    anything pushed after the approval goes through review again."""
    marker = f"<!-- agent:approved-sha {sha} -->"
    mine = [c for c in markers.from_bot(gh.comments(pr), s.bot) if markers.tag(role) in c.body]
    if mine:
        gh.edit_comment(mine[-1].id, f"{mine[-1].body.rstrip(chr(10))}\n\n{marker}")
    else:
        gh.comment(pr, marker)
    return transition(gh, s, pr, "agent:approved")


# --- a PR's own changes ------------------------------------------------------------------------------
class IncompleteDiff(Exception):
    """GitHub's diff leaves files out (300+ files, or a binary or too large file): it can't be compared."""


def own_diff(gh: GitHub, base: str, sha: str) -> str:
    """A PR's own changes as of a commit: for each changed file (by name), its status and the added and
    removed lines in order, without positions or context. Two commits with the same own diff make
    exactly the same edits; anything else that differs between them came from the base branch."""
    files = gh.compare_files(base, sha)
    if len(files) >= MAX_COMPARE_FILES or any(f.patch is None and not (f.status == "renamed" and f.changes == 0) for f in files):
        raise IncompleteDiff(f"{base}...{sha}")
    lines: list[str] = []
    for f in sorted(files, key=lambda f: f.filename):
        moved = f" from {f.previous_filename}" if f.previous_filename else ""
        lines.append(f"=== {f.filename} ({f.status}{moved})")
        lines += [line for line in (f.patch or "").split("\n") if line[:1] in ("+", "-")]
    return "\n".join(lines)


def _same_edits(gh: GitHub, pr: int, approved: str, head: str, interdiff: str | None = None) -> bool:
    base = gh.pr(pr).base_ref
    try:
        before, after = own_diff(gh, base, approved), own_diff(gh, base, head)
    except IncompleteDiff:
        return False
    if before == after:
        return True
    if interdiff:
        diff = difflib.unified_diff(before.split("\n"), after.split("\n"), f"PR edits as approved ({approved[:7]})", f"PR edits now ({head[:7]})", lineterm="")
        with open(interdiff, "w", encoding="utf-8") as f:
            f.write("\n".join(diff) + "\n")
    return False


def same_own_changes(gh: GitHub, s: Settings, pr: int, head: str, interdiff: str | None = None) -> str | None:
    """The approved commit if the PR still makes exactly the edits approved there (e.g. after merging
    the base and resolving conflicts by keeping both sides), else None. With `interdiff`, writes how
    the edits changed since the approval (a unified diff), so a re-review can focus on that."""
    approved = approved_sha(gh, s, pr)
    if approved is None:
        return None
    if approved == head or _same_edits(gh, pr, approved, head, interdiff):
        return approved
    return None


def qa_passed(gh: GitHub, s: Settings, pr: int, head: str) -> str | None:
    """The commit QA passed, if this PR's own changes already got past QA (so the merge queue doesn't
    test them again), else None. The latest of these decides: a QA report (only a pass counts), a Lead
    decision that approved, or a human's approval (the merge gate's `agent:queued` comment with an
    approval marker). Its approved commit must be `head`, or make exactly the same own edits."""

    def counts(body: str) -> bool:
        approval_by = markers.tag("lead") in body or markers.tag("queued") in body
        return markers.tag("qa") in body or (approval_by and _approval(body) is not None)

    latest = next((c.body for c in reversed(markers.from_bot(gh.comments(pr), s.bot)) if counts(c.body)), None)
    if latest is None or (markers.tag("qa") in latest and not VERDICT_PASS.search(latest)):
        return None
    passed = _approval(latest)
    if passed is None:
        return None
    return passed if passed == head or _same_edits(gh, pr, passed, head) else None


def clean_base_update(gh: GitHub, s: Settings, pr: int, head: str) -> str | None:
    """The approved commit if `head` is only GitHub's clean merge of the base on top of it (what the
    Integrator's update-branch makes): bot-authored, committed by web-flow with a valid signature, the
    approved commit as first parent, merging in a commit that is already on the base branch."""
    approved = approved_sha(gh, s, pr)
    if approved is None:
        return None
    c = gh.commit(head)
    if not (len(c.parents) == 2 and c.parents[0] == approved and c.author_id == s.bot and c.committer_login == "web-flow" and c.verified):
        return None
    return approved if gh.compare_status(c.parents[1], gh.pr(pr).base_ref) in ("identical", "ahead") else None


def evaluate_checks(checks: list[Check], required: str) -> tuple[str, str]:
    """(pass | fail | pending | none, the failed checks as links) for the required workflows among `checks`."""
    wanted = [w.strip() for w in required.split(",")]
    mine = [c for c in checks if c.workflow in wanted]
    failed = ", ".join(f"[{c.name}]({c.link})" for c in mine if c.bucket in ("fail", "cancel"))
    if failed:
        return "fail", failed
    if not mine:
        return "none", ""
    return ("pending" if any(c.bucket == "pending" for c in mine) else "pass"), ""


# --- path rules (monorepos) ----------------------------------------------------------------------------
def _prefixes(spec: str) -> list[str]:
    return [p.strip() for p in spec.split("|") if p.strip()]


class _Files:
    """A PR's changed files, read once and only when a rule needs them. No files is an error: it must
    never look like "changes nothing" and drop a required check."""

    def __init__(self, gh: GitHub, pr: int) -> None:
        self.gh, self.pr = gh, pr
        self._files: list[str] | None = None

    def under(self, spec: str) -> bool:
        prefixes = _prefixes(spec)
        if not prefixes:
            return True
        if self._files is None:
            self._files = self.gh.pr_files(self.pr)
            if not self._files:
                raise GhError(f"PR #{self.pr} lists no changed files")
        return any(f.startswith(p) for p in prefixes for f in self._files)


def required_checks(gh: GitHub, pr: int, spec: str) -> list[str]:
    """The required checks that apply to a PR, from AGENT_REQUIRED_CHECKS: comma-separated `Name`
    (always required) or `Name@prefix|prefix…` (only when the PR changes a file under a prefix)."""
    files = _Files(gh, pr)
    out: list[str] = []
    for entry in (e.strip() for e in spec.split(",")):
        name, scoped, where = entry.partition("@")
        if entry and (not scoped or files.under(where)):
            out.append(name.strip())
    return out


def touches(gh: GitHub, pr: int, spec: str) -> bool:
    """Does the PR change a file under one of the `|`-separated prefixes (an empty list matches)?"""
    return _Files(gh, pr).under(spec)


# --- the guard before a Reviewer or QA run ---------------------------------------------------------------
WAITING = ("agent:changes-requested", "agent:needs-decision")
MERGEABILITY_TRIES = 5


def mergeable(gh: GitHub, pr: int, clock: Clock) -> str:
    """GitHub computes mergeability lazily; UNKNOWN means "not yet", so ask a few times."""
    state = "UNKNOWN"
    for _ in range(MERGEABILITY_TRIES):
        state = gh.pr_mergeable(pr)
        if state != "UNKNOWN":
            break
        clock.sleep(10)
    return state


def _moved_on(view: PullRequest, sha: str) -> str | None:
    """The PR is closed, a draft, or has newer commits (whose own run handles them)."""
    if not view.is_open:
        return f"PR is {view.state}"
    if view.is_draft:
        return "PR is a draft"
    if view.head_sha != sha:
        return f"newer commit {view.head_sha[:7]} was pushed, its own run handles it"
    return None


def _waits_for_someone(gh: GitHub, s: Settings, view: PullRequest) -> str | None:
    """The PR waits for another agent or a human."""
    waiting = next((label for label in view.labels if label in WAITING), None)
    if waiting:
        # GitHub keeps one pending run per concurrency group, so the push that queued this run can have
        # replaced the pending run for that state. Re-applying the label queues its handler again.
        transition(gh, s, view.number, waiting)
        return f"PR is waiting in {waiting}, re-queued its handler"
    return "PR is waiting for a human" if "agent:needs-human" in view.labels else None


def _stays_in_queue(gh: GitHub, s: Settings, view: PullRequest) -> str | None:
    """Why a queued PR stays the Integrator's business: its head is the approved commit, or the
    Integrator's clean update of it, or that couldn't be checked (an API error must never take a PR out
    of the queue: the Integrator may be merging it right now). None: anyone else's push took it out of
    the queue, and this run reviews it."""
    try:
        if view.head_sha == approved_sha(gh, s, view.number) or clean_base_update(gh, s, view.number, view.head_sha) is not None:
            return "PR is in the merge queue"
    except GhError:
        return "PR is in the merge queue (couldn't check its new commits, the Integrator decides)"
    pr = view.number
    transition(gh, s, pr, None)
    gh.comment(pr, f"🔁 #{pr} got new commits while it was in the merge queue, so it leaves the queue and goes through review again.")
    progress(gh, s, f"🚦 **Merge queue**: #{pr} got new commits, left the queue for review", pr=pr)
    return None


def _send_back_if_conflicting(gh: GitHub, s: Settings, view: PullRequest, clock: Clock) -> bool:
    if mergeable(gh, view.number, clock) != "CONFLICTING":
        return False
    pr, base = view.number, view.base_ref
    transition(gh, s, pr, "agent:changes-requested")
    gh.comment(
        pr,
        f"<!-- agent:merge -->\n⚠️ This PR **conflicts** with `{base}`, so review and QA are paused. Implementor: run "
        f"`git fetch origin {base}` and `git merge origin/{base}`, resolve the conflicts keeping the intent of both changes, run all checks, and push.",
    )
    progress(gh, s, f"🚦 **Conflict**: #{pr} conflicts with `{base}`, back to the Implementor", pr=pr)
    return True


def still_current(gh: GitHub, s: Settings, pr: int, sha: str, required: str | None = None, *, clock: Clock | None = None) -> str | None:
    """Why a queued Reviewer/QA run should stop (None: go ahead). Runs wait on the PR's concurrency
    group, so by the time one starts the PR may have moved on: new commits, another agent's state, the
    merge queue, or a conflict with a just-merged PR (which is sent to the Implementor here)."""
    view = gh.pr(pr)
    reason = _moved_on(view, sha) or _waits_for_someone(gh, s, view)
    if reason:
        return reason
    labels = view.labels
    if "agent:queued" in labels or "agent:integrating" in labels:
        stays = _stays_in_queue(gh, s, view)
        if stays:
            return stays
        labels = gh.pr(pr).labels  # it just left the queue
    if required and required not in labels:
        return f"PR no longer has {required} (labels: {','.join(labels) or 'none'})"
    if _send_back_if_conflicting(gh, s, view, clock or SystemClock()):
        return f"PR conflicts with {view.base_ref}, sent to the Implementor"
    return None
