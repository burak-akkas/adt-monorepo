"""Settings from the environment the workflows give every step."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass


class ConfigError(Exception):
    """A required setting is missing or malformed."""


@dataclass(frozen=True)
class Settings:
    repo: str  # owner/name
    bot_id: int | None  # the agents' bot user id: only its comments carry markers
    run_url: str = ""  # this workflow run, for progress links
    escalation_assignee: str = ""  # who gets assigned when work is escalated to a human

    @property
    def bot(self) -> int:
        """The bot id, for the commands that can't work without it."""
        if self.bot_id is None:
            raise ConfigError("AGENT_BOT_ID must be set")
        return self.bot_id

    @property
    def owner(self) -> str:
        return self.repo.split("/", 1)[0]

    @property
    def name(self) -> str:
        return self.repo.split("/", 1)[-1]

    @classmethod
    def from_env(cls, env: Mapping[str, str]) -> Settings:
        repo = env.get("GITHUB_REPOSITORY", "")
        if not repo:
            raise ConfigError("GITHUB_REPOSITORY must be set")
        raw = env.get("AGENT_BOT_ID", "")
        try:
            bot_id = int(raw) if raw else None
        except ValueError:
            raise ConfigError(f"AGENT_BOT_ID must be a number, not {raw!r}") from None
        server = env.get("GITHUB_SERVER_URL") or "https://github.com"
        return cls(
            repo=repo,
            bot_id=bot_id,
            run_url=f"{server}/{repo}/actions/runs/{env.get('GITHUB_RUN_ID', '')}",
            escalation_assignee=env.get("AGENT_ESCALATION_ASSIGNEE", ""),
        )


def flag(env: Mapping[str, str], name: str, default: bool) -> bool:
    """A 'true'/'false' repository variable; anything else (or unset) is the default."""
    value = env.get(name, "")
    return default if value not in ("true", "false") else value == "true"


def number(env: Mapping[str, str], name: str, default: int) -> int:
    value = env.get(name, "")
    if not value:
        return default
    try:
        return int(value)
    except ValueError:
        raise ConfigError(f"{name} must be a number, not {value!r}") from None


DEFAULT_URLS = {"preview": "https://{owner}.github.io/{repo}/pr-{pr}/", "production": "https://{owner}.github.io/{repo}/"}


def link(env: Mapping[str, str], kind: str, pr: str, repo: str) -> str:
    """The project's preview or production URL from its template (AGENT_PREVIEW_URL, AGENT_PRODUCTION_URL;
    {owner}, {repo} and {pr} are filled in). "" when the template is `none` (no such site) or
    `deployment` (only the deployment knows the URL; QA finds it)."""
    if kind not in DEFAULT_URLS:
        raise ConfigError(f"url: unknown kind '{kind}'")
    template = env.get(f"AGENT_{kind.upper()}_URL") or DEFAULT_URLS[kind]
    if template in ("none", "deployment"):
        return ""
    owner, _, name = repo.partition("/")
    return template.replace("{owner}", owner).replace("{repo}", name).replace("{pr}", pr)
