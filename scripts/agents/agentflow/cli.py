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

from agentflow import config, doctor, integrator, issues, labels, markers, overlap, pages, production, prs, queue, states, tokens, watchdog
from agentflow.clock import SystemClock
from agentflow.config import ConfigError, Settings
from agentflow.github import GhCli, GhError, GitHub
from agentflow.issues import SplitError


class UsageError(Exception):
    pass


class Context:
    """What a command gets: the environment, settings and GitHub (both made on first use), and output."""

    def __init__(self, env: Mapping[str, str], gh: GitHub | None, out: TextIO, err: TextIO) -> None:
        self.env = env
        self.out = out
        self.err = err
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

Handler = Callable[[Context, argparse.Namespace], "int | None"]  # the exit code (None: 0)


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


@command("url", "the preview or production URL (AGENT_PREVIEW_URL / AGENT_PRODUCTION_URL templates)", arg("kind"), arg("pr", nargs="?", default=""))
def _url(ctx: Context, a: argparse.Namespace) -> None:
    if a.kind not in config.DEFAULT_URLS:
        raise UsageError(f"url: unknown kind '{a.kind}'")
    url = config.link(ctx.env, a.kind, a.pr, ctx.settings.repo)
    if url:
        ctx.print(url)


@command("branch-head", "the commit a branch points to on origin (nothing if it doesn't exist)", arg("branch"))
def _branch_head(ctx: Context, a: argparse.Namespace) -> None:
    try:
        p = subprocess.run(["git", "ls-remote", "--heads", "origin", f"refs/heads/{a.branch}"], capture_output=True, text=True, check=False)
    except OSError:
        return
    sha = p.stdout.split("\n", 1)[0].split("\t", 1)[0].strip()
    if sha:
        ctx.print(sha)


# --- review and approvals -------------------------------------------------------------------------
PR = arg("pr", type=int, help="pull request number")
SHA = arg("sha", help="commit sha")


def _answer(ctx: Context, sha: str | None) -> int:
    """Prints an approved sha and exits 0, or exits 1 when there is none."""
    if sha is None:
        return 1
    ctx.print(sha)
    return 0


@command("approved-sha", "the commit the agents last approved on a PR (nothing if none)", PR)
def _approved_sha(ctx: Context, a: argparse.Namespace) -> None:
    sha = prs.approved_sha(ctx.gh, ctx.settings, a.pr)
    if sha:
        ctx.print(sha)


@command("approve", "approve a PR's commit for the merge gate", PR, SHA, arg("role", help="the approving comment's marker: qa, reviewer, lead"))
def _approve(ctx: Context, a: argparse.Namespace) -> None:
    ctx.print(prs.approve(ctx.gh, ctx.settings, a.pr, a.sha, a.role))


@command("qa-passed", "exit 0 and print the commit if QA already passed this PR's own changes", PR, SHA)
def _qa_passed(ctx: Context, a: argparse.Namespace) -> int:
    return _answer(ctx, prs.qa_passed(ctx.gh, ctx.settings, a.pr, a.sha))


@command("own-diff", "a PR's own edits as of a commit (exit 2: GitHub's diff is incomplete)", arg("base"), SHA)
def _own_diff(ctx: Context, a: argparse.Namespace) -> int:
    try:
        ctx.print(prs.own_diff(ctx.gh, a.base, a.sha))
    except prs.IncompleteDiff:
        return 2
    return 0


@command(
    "same-own-changes",
    "exit 0 and print the approved commit if the PR still makes the same edits",
    PR,
    SHA,
    arg("interdiff", nargs="?", default=None, help="file to write how the edits changed"),
)
def _same_own_changes(ctx: Context, a: argparse.Namespace) -> int:
    return _answer(ctx, prs.same_own_changes(ctx.gh, ctx.settings, a.pr, a.sha, a.interdiff))


@command("clean-base-update", "exit 0 and print the approved commit if the head is only GitHub's clean merge of the base on it", PR, SHA)
def _clean_base_update(ctx: Context, a: argparse.Namespace) -> int:
    return _answer(ctx, prs.clean_base_update(ctx.gh, ctx.settings, a.pr, a.sha))


@command(
    "pr-paths",
    "path rules: `required <pr>` lists the checks that apply, `touches <pr> <prefixes>` (exit 3 on any error)",
    arg("rule", choices=("required", "touches")),
    PR,
    arg("prefixes", nargs="?", default=""),
)
def _pr_paths(ctx: Context, a: argparse.Namespace) -> int:
    try:
        if a.rule == "required":
            ctx.print(*prs.required_checks(ctx.gh, a.pr, ctx.env.get("AGENT_REQUIRED_CHECKS") or "CI"))
            return 0
        return 0 if prs.touches(ctx.gh, a.pr, a.prefixes) else 1
    except (GhError, ConfigError) as e:
        print(f"pr-paths: {e}", file=ctx.err)
        return 3  # never "doesn't change those paths"


@command(
    "pr-still-current",
    "prints skip=<reason> when a queued Reviewer/QA run should stop",
    PR,
    SHA,
    arg("required", nargs="?", default=None, help="label the PR must still have"),
)
def _pr_still_current(ctx: Context, a: argparse.Namespace) -> None:
    reason = prs.still_current(ctx.gh, ctx.settings, a.pr, a.sha, a.required)
    if reason:
        ctx.print(f"skip={reason}")


# --- the merge queue and conflict avoidance ----------------------------------------------------------------
@command("queue", "the merge queue, front first: one `<pr> <state>` line each")
def _queue(ctx: Context, a: argparse.Namespace) -> None:
    ctx.print(*(f"{n} {state}" for n, state in queue.order(ctx.gh, ctx.settings)))


@command("queue-tidy", "clear merge-queue labels from PRs that aren't open any more (never fails)")
def _queue_tidy(ctx: Context, a: argparse.Namespace) -> None:
    ctx.print(*queue.tidy(ctx.gh, ctx.settings))


@command("sweep-conflicts", "after a merge, send open agent PRs that now conflict to the Implementor (never fails)", arg("merged", type=int), arg("base"))
def _sweep_conflicts(ctx: Context, a: argparse.Namespace) -> None:
    ctx.print(*queue.sweep_conflicts(ctx.gh, ctx.settings, a.merged, a.base))


def _ignore(ctx: Context) -> str:
    return ctx.env.get("AGENT_CONFLICT_IGNORE") or overlap.DEFAULT_IGNORE


@command("overlap", "in-flight work that changes the files an issue's design plans to change: `#<n> <file>…` lines", ISSUE)
def _overlap(ctx: Context, a: argparse.Namespace) -> None:
    ctx.print(*(f"#{n} {' '.join(files)}" for n, files in overlap.blockers(ctx.gh, ctx.settings, a.number, _ignore(ctx))))


@command("release-waiting", "start issues that waited for overlapping work (AGENT_CONFLICT_WAIT_MINUTES, never fails)")
def _release_waiting(ctx: Context, a: argparse.Namespace) -> None:
    minutes = config.number(ctx.env, "AGENT_CONFLICT_WAIT_MINUTES", 120)
    ctx.print(*overlap.release_waiting(ctx.gh, ctx.settings, minutes, _ignore(ctx)))


# --- the merge queue itself and operations ----------------------------------------------------------------
@command("integrate", "the Integrator's work on one queued PR; the last stdout line is result=<merged|bounced|requeued|left|lead>", PR)
def _integrate(ctx: Context, a: argparse.Namespace) -> None:
    clock = SystemClock()

    def log(line: str) -> None:
        print(line, file=ctx.err, flush=True)

    def refresh_token() -> None:  # the App token expires after an hour, and one PR can take longer
        with contextlib.suppress(tokens.TokenError, OSError, KeyError, ValueError):
            token = tokens.app_token(ctx.env, clock)
            if token and isinstance(ctx.env, os._Environ):
                os.environ["GH_TOKEN"] = token

    cfg = integrator.Config.from_env(ctx.env, warn=log)
    result = integrator.integrate(ctx.gh, ctx.settings, a.pr, cfg, clock=clock, log=log, refresh_token=refresh_token)
    ctx.print(f"result={result}")


@command("watchdog", "re-trigger stalled agent work, restart an idle merge queue (AGENT_WATCHDOG_MINUTES, …)", arg("--dry-run", action="store_true"))
def _watchdog(ctx: Context, a: argparse.Namespace) -> None:
    env = ctx.env
    cfg = watchdog.WatchConfig(
        minutes=config.number(env, "AGENT_WATCHDOG_MINUTES", 10),
        retries=config.number(env, "AGENT_WATCHDOG_RETRIES", 2),
        auto_merge=env.get("AGENT_AUTO_MERGE") == "true",
        avoid_conflicts=env.get("AGENT_AVOID_CONFLICTS") != "false",
        conflict_wait_minutes=config.number(env, "AGENT_CONFLICT_WAIT_MINUTES", 120),
        conflict_ignore=_ignore(ctx),
        dry_run=a.dry_run,
    )
    ctx.print(*watchdog.check(ctx.gh, ctx.settings, cfg))


@command("production-check", "does production serve the merged commit (AGENT_PRODUCTION_CHECK_URL, …MINUTES)? exit 1 if not", arg("sha"), arg("base"))
def _production_check(ctx: Context, a: argparse.Namespace) -> int:
    url = ctx.env.get("AGENT_PRODUCTION_CHECK_URL") or ""
    if not url:
        raise ConfigError("AGENT_PRODUCTION_CHECK_URL must be set")
    ok, lines = production.check(ctx.gh, ctx.settings, a.sha, a.base, url, minutes=config.number(ctx.env, "AGENT_PRODUCTION_CHECK_MINUTES", 15))
    ctx.print(*lines)
    return 0 if ok else 1


@command("app-token", "a GitHub App token valid for 15 more minutes (AGENT_APP_ID, AGENT_APP_PRIVATE_KEY, AGENT_TOKEN_CACHE)")
def _app_token(ctx: Context, a: argparse.Namespace) -> int:
    try:
        token = tokens.app_token(ctx.env, SystemClock())
    except tokens.TokenError as e:
        print(f"app-token: {e}", file=ctx.err)
        return 1
    ctx.out.write(token)
    return 0


@command(
    "publish-pages",
    "publish a directory into the gh-pages branch, retrying on concurrent pushes",
    arg("src"),
    arg("dest", help='"." for the site root, e.g. "pr-12"'),
    arg("message"),
    arg("--replace", action="store_true"),
)
def _publish_pages(ctx: Context, a: argparse.Namespace) -> int:
    token = ctx.env.get("GH_TOKEN") or ""
    if not token:
        raise ConfigError("GH_TOKEN must be set")
    try:
        ctx.print(pages.publish(a.src, a.dest, a.message, a.replace, repo=ctx.settings.repo, token=token, log=ctx.print))
    except pages.PagesError as e:
        ctx.print(f"::error::{e}")
        return 1
    return 0


# --- setting a repository up (run by a person) ------------------------------------------------------------
@command("setup-labels", "create or update the agent team's labels in a repository", arg("repo", help="owner/name"))
def _setup_labels(ctx: Context, a: argparse.Namespace) -> None:
    labels.setup(GhCli(a.repo))
    ctx.print(f"{len(labels.LABELS)} labels in {a.repo}")


@command(
    "doctor", "check that a repository is wired up for the agent team (changes nothing; exit 1 if something must be fixed)", arg("repo", help="owner/name")
)
def _doctor(ctx: Context, a: argparse.Namespace) -> int:
    errors, lines = doctor.run(GhCli(a.repo), a.repo)
    ctx.print(*lines)
    return 1 if errors else 0


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
    ctx = Context(os.environ if env is None else env, gh, out, err)
    try:
        code = COMMANDS[args.command].run(ctx, args)
    except UsageError as e:
        print(e, file=err)
        return 2
    except SplitError as e:
        print(f"::error::{e}", file=err)
        return 1
    except (GhError, ConfigError) as e:
        print(f"{args.command}: {e}", file=err)
        return 1
    return code or 0
