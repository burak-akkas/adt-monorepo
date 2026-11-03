"""QA's runner work around the agent: starting the app (and a baseline of the base branch) on the
runner, finding what QA compares against, running the e2e suite, and showing the screenshots on the PR."""

from __future__ import annotations

import contextlib
import glob
import os
import shutil
import subprocess
from collections.abc import Mapping
from typing import Any

from agentflow import pages
from agentflow.clock import Clock, SystemClock
from agentflow.config import Settings
from agentflow.github import GhError, GitHub
from agentflow.production import curl
from agentflow.step import StepIO, result

MCP_CONFIG = (
    '{"mcpServers":{"playwright":{"command":"npx","args":["-y","@playwright/mcp@0.0.83","--headless","--isolated",'
    '"--viewport-size","1280x800","--output-dir",".agent-out/screenshots"]}}}\n'
)


def answers(url: str) -> bool:
    """Does the URL answer at all (curl -f, so the simulator's fake curl applies)?"""
    try:
        return subprocess.run(["curl", "-fsS", "-o", "/dev/null", url], capture_output=True, check=False).returncode == 0
    except OSError:
        return False


def _tail(path: str, lines: int) -> str:
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            return "".join(f.readlines()[-lines:]).rstrip("\n")
    except OSError:
        return ""


def _start(command: str, log: str, cwd: str | None = None) -> None:
    """Starts a command in the background, in its own session, so it keeps running after this step (as
    `nohup … &` did) until the job ends."""
    with open(log, "w", encoding="utf-8") as out:
        subprocess.Popen(["bash", "-c", command], cwd=cwd, stdout=out, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, start_new_session=True)


def _wait_for(url: str, clock: Clock, tries: int = 120, every: float = 5) -> bool:
    for _ in range(tries):
        if answers(url):
            return True
        clock.sleep(every)
    return False


def start_app(io: StepIO, command: str, url: str, clock: Clock | None = None) -> None:
    """AGENT_PREVIEW_URL=none: QA starts the app on the runner (AGENT_QA_START_COMMAND) and tests it there."""
    if not command:
        io.say("::error::AGENT_PREVIEW_URL is none, so QA needs AGENT_QA_START_COMMAND to start the app")
        return
    os.makedirs(".agent-out", exist_ok=True)
    _start(command, ".agent-out/app.log")
    if _wait_for(url, clock or SystemClock()):
        io.output(ready="true")
        return
    io.warn(f"The app never answered at {url}")
    io.say(_tail(".agent-out/app.log", 30))


def start_baseline(io: StepIO, command: str, url: str, runner_temp: str, clock: Clock | None = None) -> None:
    """Starts the base branch's checkout (.agent-baseline) outside the workspace, so the PR's build never
    sees its files, with its own data (AGENT_BASELINE_START_COMMAND)."""
    where = os.path.join(runner_temp, "agent-baseline")
    shutil.move(".agent-baseline", where)
    commit = subprocess.run(["git", "-C", where, "rev-parse", "--short", "HEAD"], capture_output=True, text=True, check=False).stdout.strip()
    log = os.path.join(os.getcwd(), ".agent-out", "baseline.log")
    os.makedirs(os.path.dirname(log), exist_ok=True)
    _start(command, log, cwd=where)
    if _wait_for(url, clock or SystemClock()):
        io.output(info=f"{url} (the base branch at {commit}, running on this machine with its own data)")
        return
    io.warn(f"The baseline never answered at {url}")
    io.say(_tail(log, 30))
    io.output(info=f"none (the baseline never answered at {url} on this machine)")


def find_baseline(io: StepIO, gh: GitHub, s: Settings, *, template: str, base: str, local: str, clock: Clock | None = None) -> None:
    """What QA compares the PR's screens with: the baseline on the runner, or a deployed site (usually
    production) and which commit it serves."""
    if local:
        io.output(info=local)
        return
    if template == "none":
        io.output(info="none (visual comparison turned off)")
        return
    url = template.replace("{owner}", s.owner).replace("{repo}", s.name)
    live = "".join((curl(f"{url}version.txt?t={int((clock or SystemClock()).now())}") or "").split())
    base_sha = ""
    with contextlib.suppress(GhError):
        base_sha = gh.branch_head(base)
    if not answers(url):
        info = f"none (the baseline at {url} is unreachable)"
    elif not live:
        info = f"{url} (serves an unknown commit: no version.txt)"
    elif live == base_sha:
        info = f"{url} (serves {live[:7]}, the head of `{base}`)"
    else:
        info = f"{url} (serves {live[:7]}, but `{base}` is at {base_sha[:7]}, so it lags the base branch)"
    io.output(info=info)
    io.say(f"info={info}")


def e2e_setup(command: str, setup: str) -> int:
    """Installs what the e2e suite needs (AGENT_E2E_SETUP, default npm ci), unless there is no suite."""
    if command == "none" or setup == "none":
        return 0
    return subprocess.run(["bash", "-eo", "pipefail", "-c", setup], check=False).returncode


def run_e2e(io: StepIO, command: str) -> None:
    """Runs the project's e2e suite against the preview (AGENT_E2E_COMMAND, default npx playwright test);
    QA reads its results. Its exit code is an output, never this step's: a red suite is QA's finding."""
    os.makedirs(".agent-out", exist_ok=True)
    if command == "none":
        with open(".agent-out/e2e-results.txt", "w", encoding="utf-8") as f:
            f.write("No e2e suite (AGENT_E2E_COMMAND=none)\n")
        io.output(exit="none")
    else:
        with open(".agent-out/e2e-results.txt", "w", encoding="utf-8") as f:
            code = subprocess.run(["bash", "-o", "pipefail", "-c", command], stdout=f, stderr=subprocess.STDOUT, check=False).returncode
        io.output(exit=code)
        io.say(_tail(".agent-out/e2e-results.txt", 20))
    with open(".agent-out/mcp.json", "w", encoding="utf-8") as f:
        f.write(MCP_CONFIG)


def screenshots() -> list[str]:
    """QA's screenshots, as the bash glob listed them: the PNGs, then the JPEGs (.jpeg, then .jpg), each sorted."""
    return [f for pattern in ("*.png", "*.jpeg", "*.jpg") for f in sorted(glob.glob(os.path.join(".agent-out/screenshots", pattern)))]


def _caption(res: Mapping[str, Any], name: str) -> str:
    for shot in res.get("screenshots") or []:
        if isinstance(shot, dict) and str(shot.get("file") or "").endswith(name) and shot.get("caption") is not None:
            return str(shot["caption"])
    return name


def publish_screenshots(io: StepIO, gh: GitHub, s: Settings, *, pr: int, run_id: str, raw: str, round_: str, keep_days: str, token: str) -> None:
    """AGENT_QA_SCREENSHOTS=pages: the screenshots go to gh-pages, and a comment on the PR shows them."""
    files = screenshots()
    if not files:
        io.say("No screenshots")
        return
    where = f"qa/pr-{pr}/{run_id}"
    os.makedirs(".agent-out/publish", exist_ok=True)
    for f in files:
        shutil.copy2(f, ".agent-out/publish/")
    io.say(pages.publish(".agent-out/publish", where, f"qa: screenshots for PR #{pr}", repo=s.repo, token=token, log=io.say))
    base = f"https://raw.githubusercontent.com/{s.repo}/gh-pages/{where}"
    res = result(raw)
    parts = [f"<!-- agent:qa-screenshots -->\n### 📸 QA screenshots (round {round_})\n"]
    for f in files:
        name = os.path.basename(f)
        parts.append(f"\n**{_caption(res, name)}**\n\n![{name}]({base}/{name})\n")
    parts.append(f"\n_Screenshots are kept for {keep_days} days after this PR closes (full set in the run artifacts for 14 days)._\n")
    gh.comment(pr, "".join(parts))


def link_screenshots(io: StepIO, gh: GitHub, *, pr: int, raw: str, round_: str, link: str) -> None:
    """AGENT_QA_SCREENSHOTS=artifact (private repositories): a comment lists them and links the artifact."""
    files = screenshots()
    if not files:
        io.say("No screenshots")
        return
    res = result(raw)
    lines = [f"<!-- agent:qa-screenshots -->\n### 📸 QA screenshots (round {round_})\n",
             f"\n{len(files)} screenshots are in the [run artifact]({link}) (kept 14 days):\n\n"]  # fmt: skip
    lines += [f"- `{os.path.basename(f)}`: {_caption(res, os.path.basename(f))}\n" for f in files]
    gh.comment(pr, "".join(lines))
