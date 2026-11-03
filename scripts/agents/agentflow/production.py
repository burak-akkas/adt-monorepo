"""After a merge: does production serve the merged commit? Polls a URL (a health endpoint or version.txt
that reports the deployed commit) until its body contains the commit's sha.

  ok, and an earlier failure's issue is open: says so there and closes it
  not ok, and the base branch moved on: nothing to report, the newer merge's check takes over
  not ok: opens one issue for a human (or adds to the one already open)

Failures go to a human, not the agents: a broken production usually needs someone with access to it.
"""

from __future__ import annotations

import subprocess
from collections.abc import Callable

from agentflow.clock import Clock, SystemClock
from agentflow.config import Settings
from agentflow.github import GitHub
from agentflow.states import transition

MARKER = "<!-- agent:production-check -->"


def curl(url: str) -> str | None:
    """The body at a URL, None if it can't be fetched (curl, so the simulator's fake curl answers)."""
    try:
        p = subprocess.run(["curl", "-fsSL", "--max-time", "20", url], capture_output=True, text=True, check=False)
    except OSError:
        return None
    return p.stdout if p.returncode == 0 else None


def _open_issue(gh: GitHub) -> int | None:
    return next((i.number for i in gh.open_items() if MARKER in i.body), None)


def check(
    gh: GitHub,
    s: Settings,
    sha: str,
    base: str,
    url: str,
    *,
    minutes: int = 15,
    fetch: Callable[[str], str | None] = curl,
    base_head: Callable[[str], str] | None = None,
    clock: Clock | None = None,
) -> tuple[bool, list[str]]:
    """(ok, what to print). Not ok means production doesn't serve the merged commit and an issue says so."""
    clock = clock or SystemClock()
    sep = "&" if "?" in url else "?"
    body: str | None = None
    for _ in range(minutes * 2):
        body = fetch(f"{url}{sep}t={int(clock.now())}")
        if body is not None and sha in body:
            issue = _open_issue(gh)
            if issue:
                gh.comment(issue, f"✅ Production serves `{sha[:7]}` again. Closing.")
                gh.close_issue(issue, "completed")
            return True, [f"Production serves {sha}"]
        clock.sleep(30)

    head = (base_head or gh.branch_head)(base)
    if head != sha:
        return True, [f"Production never served {sha}, but `{base}` is at {head} by now: the newer merge's check takes over"]

    last = (body or "nothing")[:200]
    for ch in "`\r\n":
        last = last.replace(ch, "")
    summary = f"Production didn't serve `{sha[:7]}` at {url} within {minutes} minutes ([run]({s.run_url})). Last response: `{last}`"
    out: list[str] = []
    issue = _open_issue(gh)
    if issue:
        gh.comment(issue, f"⚠️ Still failing. {summary}")
    else:
        n = gh.create_issue(
            f"Production check failed for {sha[:7]}",
            f"{MARKER}\n⚠️ {summary}\n\nThe deploy may have failed, or the app may be down. Check the deploy workflow and the host. "
            "This issue closes itself when production serves a merged commit again.\n",
        )
        out.append(transition(gh, s, n, "agent:needs-human"))
    out.append(f"::error::Production didn't serve {sha} at {url} within {minutes} minutes")
    return False, out
