"""Command line: one command per former script, with the same name, arguments and output.

    python3 -I scripts/agents/agentflow <command> [args]

Exit codes: 0 done, 1 failed (GitHub error, missing setting, bad input), 2 wrong usage.
"""

from __future__ import annotations

import argparse
import contextlib
import json
import os
import subprocess
import sys
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, TextIO

from agentflow import config, issues, markers, states
from agentflow.config import ConfigError, Settings
from agentflow.github import GhCli, GhError, GitHub
from agentflow.issues import SplitError


class UsageError(Exception):
    pass


class Context:
    """What a command gets: the environment, settings and GitHub (both made on first use), and output."""

    def __init__(self, env: Mapping[str, str], gh: GitHub | None, out: TextIO) -> None:
        self.env = env
        self.out = out
        self._gh = gh
        self._settings: Settings | None = None

    @property
    def settings(self) -> Settings:
        if self._settings is None:
            self._settings = Settings.from_env(self.env)
        return self._settings

    @property
    def gh(self) -> GitHub:
        if self._gh is None:
            self._gh = GhCli(self.settings.repo)
        return self._gh

    def print(self, *lines: str) -> None:
        for line in lines:
            print(line, file=self.out)


@dataclass(frozen=True)
class Arg:
    """One argparse argument: its name and add_argument keywords."""

    name: str
    options: Mapping[str, Any] = field(default_factory=dict)


def arg(name: str, **options: Any) -> Arg:
    return Arg(name, options)


ISSUE = arg("number", type=int, help="issue or PR number")

Handler = Callable[[Context, argparse.Namespace], None]


@dataclass(frozen=True)
class Command:
    name: str
    help: str
    args: tuple[Arg, ...]
    run: Handler


COMMANDS: dict[str, Command] = {}


def command(name: str, help_: str, *args: Arg) -> Callable[[Handler], Handler]:
    def register(fn: Handler) -> Handler:
        COMMANDS[name] = Command(name, help_, args, fn)
        return fn

    return register


# --- commands ----------------------------------------------------------------------------------------
@command("transition", "move an issue or PR to a new agent:* state (no label: clear it)", ISSUE, arg("label", nargs="?", default=None))
def _transition(ctx: Context, a: argparse.Namespace) -> None:
    ctx.print(states.transition(ctx.gh, ctx.settings, a.number, a.label or None))


@command(
    "progress",
    "append a line to an issue's progress comment (--pr: to the issue the PR closes); never fails",
    arg("--pr", action="store_true"),
    ISSUE,
    arg("line"),
)
def _progress(ctx: Context, a: argparse.Namespace) -> None:
    try:
        s = ctx.settings
    except ConfigError:
        return
    if a.pr:
        states.progress(ctx.gh, s, a.line, pr=a.number)
    else:
        states.progress(ctx.gh, s, a.line, issue=a.number)


@command("count-comments", "how many of the bot's comments carry a role's marker", ISSUE, arg("role"))
def _count_comments(ctx: Context, a: argparse.Namespace) -> None:
    ctx.print(str(markers.count(ctx.gh.comments(a.number), ctx.settings.bot, a.role)))


@command("lead-budget", "Lead decisions since the item was last escalated to a human", ISSUE)
def _lead_budget(ctx: Context, a: argparse.Namespace) -> None:
    ctx.print(str(issues.lead_budget(ctx.gh, ctx.settings, a.number)))


@command("split-mode", "may, must or must not the Architect split this issue (AGENT_SPLIT, AGENT_MAX_SPLIT_DEPTH)", ISSUE)
def _split_mode(ctx: Context, a: argparse.Namespace) -> None:
    enabled = config.flag(ctx.env, "AGENT_SPLIT", True)
    max_depth = config.number(ctx.env, "AGENT_MAX_SPLIT_DEPTH", 2)
    ctx.print(str(issues.split_mode(ctx.gh, ctx.settings, a.number, enabled=enabled, max_depth=max_depth)))


@command("split", "split an issue into sub-issues following the Architect's plan (AGENT_MAX_SUBISSUES)", arg("parent", type=int), arg("plan"))
def _split(ctx: Context, a: argparse.Namespace) -> None:
    try:
        with open(a.plan, encoding="utf-8") as f:
            plan = json.load(f)
    except (OSError, json.JSONDecodeError) as e:
        raise SplitError(f"Can't read the split plan {a.plan}: {e}") from e
    ctx.print(*issues.split(ctx.gh, ctx.settings, a.parent, plan, config.number(ctx.env, "AGENT_MAX_SUBISSUES", 5)))


@command("subissues", "advance the parent of a closed sub-issue, or every split issue (--sweep)", arg("target", help="closed sub-issue, or --sweep"))
def _subissues(ctx: Context, a: argparse.Namespace) -> None:
    if a.target == "--sweep":
        ctx.print(*issues.sweep(ctx.gh, ctx.settings))
    elif a.target.isdigit():
        ctx.print(*issues.sub_issue_closed(ctx.gh, ctx.settings, int(a.target)))
    else:
        raise UsageError("usage: subissues <closed-sub-issue> | --sweep")


@command("release-blocked", "restart issues whose dependencies are done")
def _release_blocked(ctx: Context, a: argparse.Namespace) -> None:
    ctx.print(*issues.release_blocked(ctx.gh, ctx.settings))


DEFAULT_URLS = {"preview": "https://{owner}.github.io/{repo}/pr-{pr}/", "production": "https://{owner}.github.io/{repo}/"}


@command("url", "the preview or production URL (AGENT_PREVIEW_URL / AGENT_PRODUCTION_URL templates)", arg("kind"), arg("pr", nargs="?", default=""))
def _url(ctx: Context, a: argparse.Namespace) -> None:
    if a.kind not in DEFAULT_URLS:
        raise UsageError(f"url: unknown kind '{a.kind}'")
    template = ctx.env.get(f"AGENT_{a.kind.upper()}_URL") or DEFAULT_URLS[a.kind]
    if template in ("none", "deployment"):
        return  # none: no such site; deployment: only the deployment knows the URL (QA finds it)
    s = ctx.settings
    ctx.print(template.replace("{owner}", s.owner).replace("{repo}", s.name).replace("{pr}", a.pr))


@command("branch-head", "the commit a branch points to on origin (nothing if it doesn't exist)", arg("branch"))
def _branch_head(ctx: Context, a: argparse.Namespace) -> None:
    try:
        p = subprocess.run(["git", "ls-remote", "--heads", "origin", f"refs/heads/{a.branch}"], capture_output=True, text=True, check=False)
    except OSError:
        return
    sha = p.stdout.split("\n", 1)[0].split("\t", 1)[0].strip()
    if sha:
        ctx.print(sha)


# --- entry point -------------------------------------------------------------------------------------
def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="agentflow", description="The agent team's tooling (scripts/agents).")
    sub = p.add_subparsers(dest="command", required=True)
    for c in COMMANDS.values():
        cp = sub.add_parser(c.name, help=c.help, description=c.help)
        for a in c.args:
            cp.add_argument(a.name, **a.options)
    return p


def main(
    argv: Sequence[str],
    *,
    gh: GitHub | None = None,
    env: Mapping[str, str] | None = None,
    stdout: TextIO | None = None,
    stderr: TextIO | None = None,
) -> int:
    out, err = stdout or sys.stdout, stderr or sys.stderr
    argv = list(argv)
    if argv[:2] == ["subissues", "--sweep"]:  # a value that looks like a flag to argparse
        argv = ["subissues", "--", "--sweep", *argv[2:]]
    try:
        with contextlib.redirect_stderr(err), contextlib.redirect_stdout(out):
            args = parser().parse_args(argv)
    except SystemExit as e:
        return 0 if e.code in (0, None) else 2
    ctx = Context(os.environ if env is None else env, gh, out)
    try:
        COMMANDS[args.command].run(ctx, args)
    except UsageError as e:
        print(e, file=err)
        return 2
    except SplitError as e:
        print(f"::error::{e}", file=err)
        return 1
    except (GhError, ConfigError) as e:
        print(f"{args.command}: {e}", file=err)
        return 1
    return 0
