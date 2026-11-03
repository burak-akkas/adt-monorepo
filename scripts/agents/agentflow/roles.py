"""What happens after each issue-side agent ran (the "Apply state transition" steps of the Analyst,
Architect and Implementor workflows), and the steps around them. The agent's structured result decides
the next state; a result without the handoff comment the role must post counts as a failure."""

from __future__ import annotations

import contextlib
import json
import os
import re
import subprocess
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from agentflow import config, issues, markers, overlap
from agentflow.config import Settings
from agentflow.github import GhError, GitHub
from agentflow.issues import SplitError
from agentflow.states import progress, transition
from agentflow.step import StepIO, field_of, posted, result, run_log


def move(gh: GitHub, s: Settings, io: StepIO, number: int, label: str | None) -> None:
    """A transition, logged like the scripts did ("#7 -> agent:ready")."""
    io.say(transition(gh, s, number, label))


def ignore_scratch(*paths: str) -> None:
    """The scratch folders the agents write to stay out of git (`.git/info/exclude`)."""
    os.makedirs(".agent-out", exist_ok=True)
    if os.path.isdir(".git"):
        os.makedirs(".git/info", exist_ok=True)
        with open(".git/info/exclude", "a", encoding="utf-8") as f:
            f.write("".join(p + "\n" for p in paths))


# --- the Analyst -------------------------------------------------------------------------------------
def analyst_apply(gh: GitHub, s: Settings, io: StepIO, n: int, *, raw: str, before: int, autonomy: str) -> None:
    decision = field_of(result(raw), "decision", "error")
    if not posted(gh, s, n, "analyst", before):
        io.warn(f"analyst returned '{decision}' but posted no handoff comment")
        decision = "missing-comment"
    if decision == "analyzed":
        move(gh, s, io, n, "agent:analyzed")
        msg = "analyzed: problem statement and acceptance criteria above"
    elif decision == "needs-info":
        move(gh, s, io, n, "agent:needs-decision" if autonomy == "full" else "agent:needs-info")
        msg = "has open questions (see above)"
    elif decision == "out-of-scope":
        move(gh, s, io, n, "agent:out-of-scope")
        msg = "out of scope (see above)"
    else:
        move(gh, s, io, n, "agent:needs-decision")
        gh.comment(n, f"⚠️ Analyst agent failed ({run_log(s)}). Handing to the Lead.")
        msg = "failed, handed to the Lead"
    progress(gh, s, f"🔍 **Analyst**: {msg}", issue=n)


# --- the Architect -----------------------------------------------------------------------------------
def architect_split_mode(gh: GitHub, s: Settings, io: StepIO, n: int, *, enabled: bool, max_depth: int, max_subissues: int) -> None:
    """The split mode, and how the Architect's prompt says it."""
    mode = issues.split_mode(gh, s, n, enabled=enabled, max_depth=max_depth)
    if mode.kind == "allowed":
        text = f"allowed, 2 to {max_subissues} subtasks"
    elif mode.kind == "required":
        text = (
            f"REQUIRED. The Lead or the size check found this too big for one PR. You must return decision `split` with 2 to {max_subissues} "
            "subtasks (read the latest `<!-- agent:split-required -->` comment)"
        )
    else:
        text = f"not allowed ({mode.reason})"
    io.output(mode=mode.kind, text=text)


@dataclass(frozen=True)
class DesignRules:
    split_mode: str  # allowed / required / not-allowed (architect_split_mode)
    require_approval: bool = False  # AGENT_REQUIRE_DESIGN_APPROVAL: every design waits for a human
    max_subissues: int = 5
    max_files: int = 20  # AGENT_MAX_PLANNED_FILES: a bigger `ready` design is sent back to be split
    avoid_conflicts: bool = True
    conflict_ignore: str = overlap.DEFAULT_IGNORE


def planned(res: Mapping[str, Any]) -> list[str]:
    """The design's files, as the workflow records them: strings only, without "./", unique and sorted."""
    return sorted({re.sub(r"^\./", "", f) for f in res.get("files") or [] if isinstance(f, str) and f})


def architect_apply(gh: GitHub, s: Settings, io: StepIO, n: int, *, raw: str, before: int, rules: DesignRules) -> None:
    res = result(raw)
    decision = field_of(res, "decision", "error")
    if not posted(gh, s, n, "architect", before):
        io.warn(f"architect returned '{decision}' but posted no handoff comment")
        decision = "missing-comment"
    risk = field_of(res, "risk", "unknown")
    if risk in ("low", "medium", "high"):
        for old in ("low", "medium", "high"):
            with contextlib.suppress(GhError):
                gh.remove_label(n, f"risk:{old}")
        gh.add_label(n, f"risk:{risk}")
    files = planned(res)
    if decision == "split" and rules.split_mode == "not-allowed":
        io.warn("Architect chose split, but splitting is not allowed here")
        decision = "needs-human"
    designed = decision in ("ready", "needs-human")
    # Asked to split (by the Lead or the size check) but didn't: the Lead decides, no second round.
    if rules.split_mode == "required" and designed:
        move(gh, s, io, n, "agent:needs-decision")
        gh.comment(n, f"⚠️ The Architect was asked to split this issue but returned `{decision}` ({run_log(s)}). Handing to the Lead.")
        progress(gh, s, f"🏛 **Architect**: asked to split, returned {decision}, handed to the Lead", issue=n)
        return
    # Size check: a design this big doesn't fit one Implementor run or one reviewable PR.
    if designed and len(files) > rules.max_files:
        _too_big(gh, s, io, n, count=len(files), rules=rules)
        return
    if files and decision != "split":
        listed = ", ".join(f"`{f}`" for f in files)
        gh.comment(n, f"<!-- agent:files {json.dumps(files, separators=(',', ':'), ensure_ascii=False)} -->\n📁 Planned files: {listed}")
    if decision == "split":
        _split(gh, s, io, n, res=res, rules=rules)
        return
    blockers = _route(gh, s, io, n, decision=decision, risk=risk, rules=rules)
    state = next((label for label in gh.labels(n) if label.startswith("agent:")), "")
    msg = {
        "agent:ready": f"design ready, risk **{risk}**, implementing",
        "agent:design-review": f"design ready, risk **{risk}**, waiting for human approval",
        "agent:waiting": f"design ready, risk **{risk}**, ⏸️ waiting for {issues.refs([b for b, _ in blockers])} to merge first (same files)",
    }.get(state, f"risk **{risk}**, handed to the Lead")
    progress(gh, s, f"🏛 **Architect**: {msg}", issue=n)


def _route(gh: GitHub, s: Settings, io: StepIO, n: int, *, decision: str, risk: str, rules: DesignRules) -> list[tuple[int, list[str]]]:
    """Where a finished design goes: human approval, waiting for overlapping work, implementation, or
    the Lead. Returns the in-flight work it waits for, if any."""
    designed = decision in ("ready", "needs-human")
    blockers: list[tuple[int, list[str]]] = []
    if designed and rules.require_approval:
        move(gh, s, io, n, "agent:design-review")
        gh.comment(
            n,
            f"👀 Design is waiting for human approval (risk: **{risk}**). Apply `agent:ready` to start implementation, "
            "or comment and re-apply `agent:analyzed` to redesign.",
        )
    elif decision == "ready" and risk != "high":
        # Conflict avoidance: wait for in-flight work on the same files to merge, then start from code that
        # contains it (release-waiting starts it). A failed check never blocks.
        if rules.avoid_conflicts:
            with contextlib.suppress(GhError):
                blockers = overlap.blockers(gh, s, n, rules.conflict_ignore)
        if blockers:
            move(gh, s, io, n, "agent:waiting")
            listing = "\n".join(f"- #{b}: {' '.join(fs)}" for b, fs in blockers)
            gh.comment(
                n,
                "⏸️ **Conflict avoidance:** the design changes files that work in flight changes too, so this waits until that work "
                f"merges, then starts from the latest code (at most `AGENT_CONFLICT_WAIT_MINUTES`, default 120):\n{listing}",
            )
        else:
            move(gh, s, io, n, "agent:ready")
    elif designed:
        move(gh, s, io, n, "agent:needs-decision")
    else:
        move(gh, s, io, n, "agent:needs-decision")
        gh.comment(n, f"⚠️ Architect agent failed ({run_log(s)}). Handing to the Lead.")
    return blockers


def _too_big(gh: GitHub, s: Settings, io: StepIO, n: int, *, count: int, rules: DesignRules) -> None:
    limit = f"the design plans {count} files, the limit is {rules.max_files} (`AGENT_MAX_PLANNED_FILES`)"
    if rules.split_mode == "allowed":
        gh.comment(
            n,
            f"<!-- agent:split-required -->\n📏 **Too big for one PR:** {limit}. The Architect runs again and splits it into sub-issues, "
            "keeping the design above as the shared design.",
        )
        move(gh, s, io, n, "agent:analyzed")
        progress(gh, s, f"🏛 **Architect**: design plans {count} files (limit {rules.max_files}), 📏 splitting it", issue=n)
    else:
        move(gh, s, io, n, "agent:needs-decision")
        gh.comment(n, f"📏 **Too big for one PR:** {limit}, and this issue can't be split further. Handing to the Lead.")
        progress(gh, s, f"🏛 **Architect**: design plans {count} files (limit {rules.max_files}), can't split, handed to the Lead", issue=n)


def _split(gh: GitHub, s: Settings, io: StepIO, n: int, *, res: Mapping[str, Any], rules: DesignRules) -> None:
    done: list[str] = []
    try:
        issues.split(gh, s, n, res, rules.max_subissues, out=done)
    except (SplitError, GhError) as e:
        io.say(f"::error::{e}" if isinstance(e, SplitError) else str(e))
        move(gh, s, io, n, "agent:needs-decision")
        created = " ".join(line.split()[1].rstrip(":") for line in done if line.startswith("Created #")) or "none"
        gh.comment(n, f"⚠️ Splitting failed ({run_log(s)}). Sub-issues created so far: {created}. Handing to the Lead.")
        progress(gh, s, "🏛 **Architect**: split failed, handed to the Lead", issue=n)
        return
    for line in done:
        io.note(line)
    progress(gh, s, f"🏛 **Architect**: too big for one PR, 🧩 split into {done[-1].rsplit(' into ', 1)[-1]}", issue=n)


# --- the Implementor ---------------------------------------------------------------------------------
def git_identity(bot: str, bot_id: str) -> None:
    for key, value in (("user.name", bot), ("user.email", f"{bot_id}+{bot}@users.noreply.github.com")):
        subprocess.run(["git", "config", key, value], check=True)


def branch_head(branch: str) -> str:
    p = subprocess.run(["git", "ls-remote", "--heads", "origin", f"refs/heads/{branch}"], capture_output=True, text=True, check=False)
    return p.stdout.split("\n", 1)[0].split("\t", 1)[0].strip()


def implementor_prepare(gh: GitHub, s: Settings, io: StepIO, n: int, *, branch: str, bot: str, bot_id: str) -> None:
    ignore_scratch(".agent-out/")
    git_identity(bot, bot_id)
    io.output(head=branch_head(branch))  # where the branch stood: a run that moves it made progress
    move(gh, s, io, n, "agent:in-progress")


def implementor_apply(
    gh: GitHub, s: Settings, io: StepIO, n: int, *, raw: str, branch: str, before: str, max_continuations: int, links: Mapping[str, str] | None = None
) -> None:
    """After the Implementor: a PR (on to review), waiting for other issues (parked), progress pushed
    (continue, a few times per design), or stuck (the Lead)."""
    res = result(raw)
    status = field_of(res, "status", "error")
    reason = field_of(res, "reason", "agent did not finish")
    # The agent can open the PR and then run out of turns before reporting. The open PR is what counts.
    existing = gh.prs("open", head=branch)
    pr: int | None = int(res["pr_number"]) if isinstance(res.get("pr_number"), int) else None
    if status != "pr-opened" and existing:
        io.warn(f"Agent reported '{status}' but PR #{existing[0].number} is open for {branch}; continuing with it")
        status, pr = "pr-opened", existing[0].number
    if status == "pr-opened":
        move(gh, s, io, n, "agent:pr-open")
        if pr:
            _opened(gh, s, io, n, pr=pr, preview_url=config.link(links or {}, "preview", str(pr), s.repo))
        return
    if status == "waiting":
        if _park(gh, s, io, n, res=res, reason=reason):
            return
        reason = f"reported waiting, but none of {json.dumps(res.get('waiting_on') or [], separators=(',', ':'))} is an open issue. {reason}"
    after = branch_head(branch)
    if status != "blocked" and after and after != before:
        mine = markers.from_bot(gh.comments(n), s.bot)
        plan = max(markers.last_index(mine, markers.tag("architect")), markers.last_index(mine, markers.tag("lead")))
        used = sum(1 for c in mine[plan + 1 :] if markers.tag("continue") in c.body)
        if used < max_continuations:
            gh.comment(
                n,
                f"<!-- agent:continue -->\n🔁 **Implementor pushed progress** to `{branch}` (`{after[:7]}`) without finishing, so it continues from "
                f"there (continuation {used + 1} of {max_continuations}). Its note: {reason}",
            )
            move(gh, s, io, n, "agent:ready")
            progress(gh, s, f"🛠 **Implementor**: pushed progress (`{after[:7]}`), 🔁 continuing ({used + 1}/{max_continuations})", issue=n)
            return
        reason = (
            f"still not finished after {max_continuations} continuation runs, the work is probably too big for one PR (consider `split`). Last note: {reason}"
        )
    move(gh, s, io, n, "agent:needs-decision")
    progress(gh, s, "🛠 **Implementor**: stopped, handed to the Lead", issue=n)
    gh.comment(n, f"⚠️ Implementor stopped: {reason} ({run_log(s)}).")


def _opened(gh: GitHub, s: Settings, io: StepIO, n: int, *, pr: int, preview_url: str) -> None:
    # Reviewer, QA and the merge gate ignore drafts (that's how humans pause the agents): an agent PR
    # must never stay one. Marking it ready triggers the Reviewer.
    if gh.pr(pr).is_draft:
        gh.mark_ready(pr)
    stats = gh.pr_stats(pr)
    link = f" · [preview]({preview_url})" if preview_url else ""
    progress(gh, s, f"🛠 **Implementor**: opened #{pr} ({stats}){link}", issue=n)


def _park(gh: GitHub, s: Settings, io: StepIO, n: int, *, res: Mapping[str, Any], reason: str) -> bool:
    """Waiting for other issues: parked until they close, without spending a Lead decision."""
    wanted = sorted({d for d in res.get("waiting_on") or [] if isinstance(d, int) and not isinstance(d, bool) and d != n})
    still_open: list[int] = []
    for d in wanted:
        with contextlib.suppress(GhError):
            i = gh.issue(d)
            if i.is_open and not i.is_pr:
                still_open.append(d)
    if not still_open:
        return False
    names = issues.refs(still_open, ", ")
    gh.comment(
        n,
        f"<!-- agent:waits-on {','.join(map(str, still_open))} -->\n⏸️ **Waiting for {names}**: {reason}\n"
        "The Implementor starts again automatically when they are closed.",
    )
    move(gh, s, io, n, "agent:blocked")
    progress(gh, s, f"🛠 **Implementor**: ⏸️ waiting for {names}", issue=n)
    return True


def fix_prepare(gh: GitHub, s: Settings, io: StepIO, pr: int, *, bot: str, bot_id: str) -> None:
    ignore_scratch(".agent-out/", ".agent-trusted/")
    git_identity(bot, bot_id)
    # agent:fixing shows the Implementor is on it: the conflict sweep leaves the PR alone, and the
    # watchdog restarts the Implementor if this run dies without a verdict.
    move(gh, s, io, pr, "agent:fixing")


def fix_apply(gh: GitHub, s: Settings, io: StepIO, pr: int, *, raw: str) -> None:
    res = result(raw)
    status = field_of(res, "status", "error")
    # On "pushed" the push fires `synchronize` and the Reviewer runs again. Only agent:fixing is cleared,
    # never a state someone set meanwhile.
    if status == "pushed":
        if "agent:fixing" in gh.pr(pr).labels:
            move(gh, s, io, pr, None)
        progress(gh, s, f"🛠 **Implementor**: pushed fixes to #{pr}", pr=pr)
        return
    progress(gh, s, f"🛠 **Implementor**: could not fix #{pr} ({status}), handed to the Lead", pr=pr)
    move(gh, s, io, pr, "agent:needs-decision")
    gh.comment(pr, f"⚠️ Implementor ({status}): {field_of(res, 'reason', 'agent did not finish')} ({run_log(s)}).")
