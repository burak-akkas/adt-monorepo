"""Checks that a repository is wired up for the agent team before the first issue: the toolkit files on
the default branch, the App's variables and secrets, the labels, the required checks, and that the QA,
merge and link settings fit together. Changes nothing.

One line per check: ✅ ok, ⚠️ worth a look, ❌ must be fixed. Variables can be set on the repository or
its organization; both are read. Reading variables and secrets needs admin access; without it the
doctor says so instead of reporting them missing.
"""

from __future__ import annotations

import subprocess
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from agentflow import config, labels
from agentflow.github import GhCli, GhError

TOOLKIT_FILES = (
    ".github/agents/implementor.md", ".github/agents/reviewer.md", ".github/agents/lead.md",
    ".github/workflows/agent-implementor.yml", ".github/workflows/agent-reviewer.yml", ".github/workflows/agent-lead.yml",
    ".github/workflows/agent-merge.yml", ".github/workflows/agent-integrator.yml", ".github/workflows/agent-watchdog.yml",
    "scripts/agents/agent.sh", "scripts/agents/agentflow/__main__.py", "CLAUDE.md",
)  # fmt: skip


def answers(url: str) -> bool:
    """Does the URL answer (curl -f)?"""
    try:
        return subprocess.run(["curl", "-fsSL", "-o", "/dev/null", "--max-time", "20", url], capture_output=True, check=False).returncode == 0
    except OSError:
        return False


@dataclass
class _Report:
    lines: list[str] = field(default_factory=list)
    errors: int = 0
    warnings: int = 0

    def ok(self, text: str) -> None:
        self.lines.append(f"✅ {text}")

    def warn(self, text: str) -> None:
        self.lines.append(f"⚠️  {text}")
        self.warnings += 1

    def bad(self, text: str) -> None:
        self.lines.append(f"❌ {text}")
        self.errors += 1


def _try(fn: Callable[[], Any]) -> Any:
    try:
        return fn()
    except GhError:
        return None


class _Doctor:
    def __init__(self, gh: GhCli, repo: str, reachable: Callable[[str], bool], info: dict[str, Any]) -> None:
        self.gh, self.repo, self.reachable, self.info = gh, repo, reachable, info
        self.r = _Report()
        self.branch, self.private = str(info.get("default_branch") or ""), bool(info.get("private"))
        repo_vars = self.listing("actions/variables", "variables")
        self.can_vars = repo_vars is not None
        self.values: dict[str, str] = {}
        for v in (repo_vars or []) + (self.listing("actions/organization-variables", "variables") or []):
            self.values.setdefault(v["name"], str(v.get("value") or ""))  # the repository's own value wins
        repo_secrets = self.listing("actions/secrets", "secrets")
        self.can_secrets = repo_secrets is not None
        self.secrets = {x["name"] for x in (repo_secrets or []) + (self.listing("actions/organization-secrets", "secrets") or [])}

    def listing(self, path: str, key: str) -> list[Any] | None:
        try:
            return self.gh.read_list(path, key)
        except GhError:
            return None

    def var(self, name: str) -> str:
        return self.values.get(name, "")

    def exists(self, path: str) -> bool:
        return _try(lambda: self.gh.read(path)) is not None

    def identity(self) -> None:
        """The App's variables and secrets."""
        r = self.r
        if not self.can_vars:
            r.warn("can't read the repository's variables with this gh login (needs admin access): the checks below assume the defaults")
        for name in ("AGENT_APP_ID", "AGENT_BOT_ID"):
            if self.var(name):
                r.ok(f"variable {name} is set")
            elif self.can_vars:
                r.bad(f"variable {name} is missing")
        bot_id = self.var("AGENT_BOT_ID")
        if bot_id:
            login = str((_try(lambda: self.gh.read(f"user/{bot_id}")) or {}).get("login") or "")
            if login.endswith("[bot]"):
                r.ok(f"AGENT_BOT_ID {bot_id} is {login}")
            elif not login:
                r.bad(f"AGENT_BOT_ID {bot_id} is no GitHub user (it's the App's bot user id: gh api users/<app-slug>[bot] --jq .id)")
            else:
                r.bad(f"AGENT_BOT_ID {bot_id} is {login}, not a bot account")
        for name in ("AGENT_APP_PRIVATE_KEY", "CLAUDE_CODE_OAUTH_TOKEN"):
            if name in self.secrets:
                r.ok(f"secret {name} is set")
            elif not self.can_secrets:
                r.warn(f"can't list secrets (needs admin access): check {name} yourself")
            else:
                r.bad(f"secret {name} is missing")

    def files_and_labels(self) -> None:
        r, branch = self.r, self.branch
        missing = [f for f in TOOLKIT_FILES if not self.exists(f"contents/{f}?ref={branch}")]
        if missing:
            r.bad(f"missing on `{branch}` (scripts/install.sh copies them): {' '.join(missing)}")
        else:
            r.ok(f"toolkit files are on `{branch}`")
        if not self.exists(f"contents/.github/ISSUE_TEMPLATE/agent-task.yml?ref={branch}"):
            r.warn(f"no issue form on `{branch}` (scripts/install.sh copies it): issues still work, without the form")
        have = {label["name"] for label in self.listing("labels?per_page=100", "") or []}
        absent = sorted(label.name for label in labels.LABELS if label.name not in have)
        if absent:
            r.bad(f"labels missing (run scripts/agents/agent.sh setup-labels {self.repo}): {' '.join(absent)}")
        else:
            r.ok("all agent labels exist")

    def required_checks(self) -> list[str]:
        """Every required check must be a workflow name, or the merge queue never sees it pass."""
        spec = self.var("AGENT_REQUIRED_CHECKS") or "CI"
        found = self.listing("actions/workflows", "workflows")
        if not found:
            self.r.warn(f"can't list the workflows: check AGENT_REQUIRED_CHECKS ({spec}) against the workflow names yourself")
            return []
        workflows = [w["name"] for w in found]
        entries = [e for e in spec.split(",") if e.strip()]
        for entry in entries:
            name, scoped, where = entry.partition("@")
            name, scope = name.strip(), f" (when a PR changes {where})" if scoped else ""
            if name in workflows:
                self.r.ok(f"required check `{name}` is a workflow{scope}")
            else:
                self.r.bad(
                    f"required check `{name}` (AGENT_REQUIRED_CHECKS) matches no workflow name, so the merge queue would never see it pass. "
                    f"Workflows: {','.join(workflows)},"
                )
        if entries and all("@" in e for e in entries):
            self.r.warn(
                "every required check in AGENT_REQUIRED_CHECKS is scoped to paths: a PR outside them merges without any check. Add one that always runs"
            )
        return entries

    def merging(self) -> None:
        method = self.var("AGENT_MERGE_METHOD") or "squash"
        allowed = {"squash": "allow_squash_merge", "merge": "allow_merge_commit", "rebase": "allow_rebase_merge"}
        if method not in allowed:
            self.r.bad(f"AGENT_MERGE_METHOD must be squash, merge or rebase, not '{method}'")
        elif self.info.get(allowed[method]) is False:
            self.r.bad(f"AGENT_MERGE_METHOD={method}, but the repository doesn't allow {method} merges")
        else:
            self.r.ok(f"merge method: {method}")
        stage = self.var("AGENT_QA_STAGE")
        if stage not in ("", "queue", "review"):
            self.r.bad(f"AGENT_QA_STAGE must be queue or review, not '{stage}'")
        if not self.can_vars:
            self.r.warn("skipped the QA, merge and pause settings checks (variables unreadable)")
        elif self.var("AGENT_QA") == "true":
            self.qa_preview()
            self.qa_baseline_and_screenshots()
        else:
            self.r.ok("QA is off (AGENT_QA): PRs merge after review and CI")

    def qa_preview(self) -> None:
        r, var, preview = self.r, self.var, self.var("AGENT_PREVIEW_URL")
        if var("AGENT_QA_PATHS"):
            r.ok(f"QA only for PRs that change {var('AGENT_QA_PATHS')} (AGENT_QA_PATHS)")
        if preview == "deployment":
            env = var("AGENT_PREVIEW_ENVIRONMENT")
            r.ok("QA tests the URL of each PR's successful GitHub deployment" + (f" in {env}" if env else "") + "; the App needs Deployments: Read")
            if not (_try(lambda: self.gh.read("deployments?per_page=5")) or []):
                r.warn(f"no GitHub deployments in {self.repo} yet: does your host report preview deployments to GitHub?")
        elif preview == "none":
            if var("AGENT_QA_START_COMMAND"):
                r.ok("QA starts the app itself (AGENT_PREVIEW_URL=none)")
            else:
                r.bad("AGENT_PREVIEW_URL=none needs AGENT_QA_START_COMMAND, or QA can't test anything")
        else:
            links = {"AGENT_PREVIEW_URL": preview, "AGENT_PRODUCTION_URL": var("AGENT_PRODUCTION_URL")}
            prod = config.link(links, "production", "", self.repo)
            r.ok(f"QA tests previews at {config.link(links, 'preview', 'N', self.repo)}; a deploy must serve version.txt with the PR's head sha")
            if prod and not self.reachable(f"{prod}version.txt"):
                r.warn(f"the production site {prod}version.txt doesn't answer: QA's visual baseline needs it (or set AGENT_BASELINE_URL=none)")

    def qa_baseline_and_screenshots(self) -> None:
        r, var, preview, baseline = self.r, self.var, self.var("AGENT_PREVIEW_URL"), self.var("AGENT_BASELINE_URL")
        if var("AGENT_BASELINE_START_COMMAND"):
            r.ok("QA starts its baseline on the runner (AGENT_BASELINE_START_COMMAND); it needs its own port and database")
        elif preview in ("none", "deployment") and baseline != "none" and (baseline or var("AGENT_PRODUCTION_URL")):
            r.warn(
                f"QA's visual baseline is {baseline or var('AGENT_PRODUCTION_URL')}. If the app stores data on a server, QA can't set up test data "
                "there: use AGENT_BASELINE_START_COMMAND (or AGENT_BASELINE_URL=none)"
            )
        if var("AGENT_E2E_COMMAND") == "none":
            r.warn("no e2e suite (AGENT_E2E_COMMAND=none): QA only tests by hand in the browser")
        shots = var("AGENT_QA_SCREENSHOTS")
        if self.private and shots == "pages":
            r.warn(
                "private repository with AGENT_QA_SCREENSHOTS=pages: raw gh-pages image links don't render there "
                "(artifact is the default for private repositories)"
            )
        if shots != "artifact" and (not self.private or shots == "pages"):
            if self.exists("branches/gh-pages"):
                r.ok("gh-pages branch exists (QA screenshots)")
            else:
                r.warn("no gh-pages branch: QA screenshots need it (or set AGENT_QA_SCREENSHOTS=artifact)")
        if var("AGENT_NODE_VERSION") == "none":
            r.ok("AGENT_NODE_VERSION=none: QA's browser tools use the runner's preinstalled Node")

    def operations(self) -> None:
        r, var = self.r, self.var
        prod_check = var("AGENT_PRODUCTION_CHECK_URL")
        if prod_check and self.reachable(prod_check):
            r.ok(f"production check: {prod_check} answers; it must contain the deployed commit's sha")
        elif prod_check:
            r.warn(f"AGENT_PRODUCTION_CHECK_URL ({prod_check}) doesn't answer: every merge will open an issue until it does")
        # A risk policy decides what needs a human, so a PR must not be able to relax it on its own.
        guide = _try(lambda: self.gh.read_raw(f"contents/CLAUDE.md?ref={self.branch}")) or ""
        if any(line.startswith("## Risk policy") for line in guide.splitlines()):
            if "CLAUDE.md" in var("AGENT_PROTECTED_PATHS").split(","):
                r.ok("CLAUDE.md has a risk policy, and AGENT_PROTECTED_PATHS protects it")
            else:
                r.warn(
                    "CLAUDE.md has a risk policy, but an agent PR could change it and merge by itself: add CLAUDE.md to AGENT_PROTECTED_PATHS "
                    "(keep the defaults: .github/,scripts/,templates/,CLAUDE.md)"
                )
        if self.can_vars and var("AGENT_AUTO_MERGE") != "true":
            r.warn("AGENT_AUTO_MERGE isn't true: approved PRs wait for a human to merge them")
        if var("AGENT_PAUSED") == "true":
            r.warn("AGENT_PAUSED is true: every agent job is stopped")
        if (_try(lambda: self.gh.read("actions/permissions")) or {}).get("enabled") is False:
            r.bad("GitHub Actions is disabled for the repository")


def run(gh: GhCli, repo: str, reachable: Callable[[str], bool] = answers) -> tuple[int, list[str]]:
    """(errors, lines). Errors are what must be fixed."""
    info = _try(lambda: gh.read(""))
    if not info:
        return 1, [f"❌ can't read {repo} with gh (logged in? access?)"]
    d = _Doctor(gh, repo, reachable, info)
    d.r.ok(f"{repo}, default branch `{d.branch}`" + (", private" if d.private else ""))
    d.identity()
    d.files_and_labels()
    d.required_checks()
    d.merging()
    d.operations()
    d.r.lines += ["", f"{d.r.errors} to fix, {d.r.warnings} to look at."]
    return d.r.errors, d.r.lines
