"""The merge queue: its order, tidying up after merges, and sending PRs that conflict after a merge back
to the Implementor."""

from __future__ import annotations

from agentflow import markers
from agentflow.clock import Clock, SystemClock
from agentflow.config import Settings
from agentflow.github import GhError, GitHub
from agentflow.prs import mergeable
from agentflow.states import progress, transition

QUEUED = markers.tag("queued")
LAST = "9999-12-31T23:59:59Z"  # no admission comment (e.g. a human applied the label by hand): last in line


def order(gh: GitHub, s: Settings) -> list[tuple[int, str]]:
    """The merge queue, front first: the PR being merged (agent:integrating), then the waiting ones
    (agent:queued) by their admission. A PR's place comes from the merge gate's `agent:queued`
    admission comment, not the label, so re-applying the label (to start a new Integrator run) keeps
    its place, and a PR approved again after being sent back rejoins at the end."""
    rows: list[tuple[int, str, int, str]] = []
    for rank, label in enumerate(("agent:integrating", "agent:queued")):
        for pr in gh.prs("open", label):
            if pr.is_draft:
                continue
            admitted = [c.created_at for c in markers.from_bot(gh.comments(pr.number), s.bot) if QUEUED in c.body]
            rows.append((rank, admitted[-1] if admitted else LAST, pr.number, label.removeprefix("agent:")))
    seen: set[int] = set()
    out: list[tuple[int, str]] = []
    for _, _, n, state in sorted(rows):
        if n not in seen:
            seen.add(n)
            out.append((n, state))
    return out


def tidy(gh: GitHub, s: Settings) -> list[str]:
    """Clears merge-queue state from PRs that aren't open any more: merged ones become agent:done,
    closed ones lose the label (e.g. after an Integrator run was killed right after merging). Never fails."""
    out: list[str] = []
    for label in ("agent:integrating", "agent:queued", "agent:approved"):
        try:
            gone = [pr for pr in gh.prs("all", label) if not pr.is_open]
        except GhError:
            continue
        for pr in gone:
            try:
                if pr.state == "MERGED":
                    transition(gh, s, pr.number, "agent:done")
                    out.append(f"#{pr.number} is merged: {label} -> agent:done")
                else:
                    transition(gh, s, pr.number, None)
                    out.append(f"#{pr.number} is closed: removed {label}")
            except GhError:
                continue
    return out


SKIP = ("agent:changes-requested", "agent:fixing", "agent:needs-decision", "agent:needs-human", "agent:integrating")
RUN_STATES = ("queued", "in_progress", "waiting", "pending", "requested")


def _implementor_busy(gh: GitHub, title: str) -> bool:
    """Is an Implementor run queued or running for this PR (run titles are the PR's title)?"""
    for status in RUN_STATES:
        try:
            if any(r.title == title for r in gh.runs(status, "agent-implementor.yml")):
                return True
        except GhError:
            continue
    return False


def sweep_conflicts(gh: GitHub, s: Settings, merged: int, base: str, clock: Clock | None = None) -> list[str]:
    """After a merge, sends the open agent PRs that now conflict with the base to the Implementor
    (GitHub runs no CI for conflicting PRs, so they would stall). Queued PRs too, so the conflict is
    resolved while the queue moves on. Skips PRs that already wait for someone, the one being merged,
    and PRs an Implementor run is working on. Never fails."""
    clock = clock or SystemClock()
    clock.sleep(20)  # give GitHub time to recompute mergeability after the merge
    out: list[str] = []
    try:
        candidates = [pr for pr in gh.prs("open", base=base) if pr.is_agent_branch]
    except GhError:
        return out
    for candidate in candidates:
        n = candidate.number
        try:
            state = mergeable(gh, n, clock)
            out.append(f"PR #{n}: {state}")
            if state != "CONFLICTING":
                continue
            pr = gh.pr(n)  # fresh: labels change while the sweep runs
            if any(label in SKIP for label in pr.labels):
                continue
            # Asked per PR, right before flagging it: another run may have started the Implementor meanwhile.
            if _implementor_busy(gh, pr.title):
                out.append(f"PR #{n}: the Implementor is already working on it")
                continue
            transition(gh, s, n, "agent:changes-requested")
            leaves = " It leaves the merge queue until that's resolved." if "agent:queued" in pr.labels else ""
            gh.comment(
                n,
                f"<!-- agent:merge -->\n⚠️ #{merged} was just merged into `{base}`, and this PR now **conflicts** with it.{leaves} "
                f"Implementor: run `git fetch origin {base}` and `git merge origin/{base}`, "
                "resolve the conflicts keeping the intent of both changes, run all checks, and push.",
            )
            progress(gh, s, f"🚦 **Merge queue**: #{n} conflicts with the just-merged #{merged}, back to the Implementor", pr=n)
        except GhError:
            continue
    return out
