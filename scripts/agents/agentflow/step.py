"""What every workflow step shares: its outputs (GITHUB_OUTPUT), its summary (GITHUB_STEP_SUMMARY),
annotations, the agent's structured result, and the check that the agent posted its handoff comment."""

from __future__ import annotations

import json
import sys
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any, TextIO

from agentflow import markers
from agentflow.config import Settings
from agentflow.github import GitHub


@dataclass
class StepIO:
    """A step's ways to talk back: outputs for later steps, the job summary, and its log."""

    outputs: dict[str, str] = field(default_factory=dict)
    summary: list[str] = field(default_factory=list)
    log: list[str] = field(default_factory=list)

    def output(self, **values: object) -> None:
        for k, v in values.items():
            self.outputs[k] = str(v)

    def note(self, line: str) -> None:
        """A line in the job summary."""
        self.summary.append(line)

    def say(self, line: str) -> None:
        """A line in the step's log (stdout)."""
        self.log.append(line)

    def tell(self, line: str) -> None:
        """Both: the summary and the log (like `| tee -a $GITHUB_STEP_SUMMARY`)."""
        self.say(line)
        self.note(line)

    def warn(self, message: str) -> None:
        self.say(f"::warning::{message}")


class FileStepIO(StepIO):
    """Writes straight to the files GitHub gives the step (and stdout), so nothing is lost if it fails."""

    def __init__(self, env: Mapping[str, str], out: TextIO | None = None) -> None:
        super().__init__()
        self._outputs, self._summary, self._out = env.get("GITHUB_OUTPUT"), env.get("GITHUB_STEP_SUMMARY"), out or sys.stdout

    def _append(self, path: str | None, text: str) -> None:
        if path:
            with open(path, "a", encoding="utf-8") as f:
                f.write(text + "\n")

    def output(self, **values: object) -> None:
        super().output(**values)
        for k, v in values.items():
            self._append(self._outputs, f"{k}={v}")

    def note(self, line: str) -> None:
        super().note(line)
        self._append(self._summary, line)

    def say(self, line: str) -> None:
        super().say(line)
        print(line, file=self._out, flush=True)


def result(raw: str | None) -> dict[str, Any]:
    """The agent's structured output (its JSON result), {} if it gave none (it ran out of turns or crashed)."""
    try:
        value = json.loads(raw) if raw and raw.strip() else None
    except json.JSONDecodeError:
        return {}
    return value if isinstance(value, dict) else {}


def field_of(res: Mapping[str, Any], key: str, default: str) -> str:
    """A result field like jq's `.key // "default"`: missing, null or false gives the default."""
    value = res.get(key)
    return default if value is None or value is False else str(value)


def posted(gh: GitHub, s: Settings, number: int, role: str, before: int) -> bool:
    """Did the agent post its handoff comment (more of the role's markers than before it ran)?"""
    return markers.count(gh.comments(number), s.bot, role) > before


def denied_tools(execution_file: str, io: StepIO) -> None:
    """Lists the tool calls the permission system refused in an agent run (from its execution log)."""
    try:
        with open(execution_file, encoding="utf-8") as f:
            events = json.load(f)
    except (OSError, json.JSONDecodeError):
        return
    lines = [
        f"- `{d.get('tool_name')}`: `{json.dumps(d.get('tool_input'), separators=(',', ':'), ensure_ascii=False)[:300]}`"
        for e in events if isinstance(e, dict) and e.get("type") == "result"
        for d in e.get("permission_denials") or []
    ]  # fmt: skip
    if lines:
        for line in ("### Denied tool calls", *lines):
            io.tell(line)
        io.warn("Agent had denied tool calls, see the job summary")


def run_log(s: Settings) -> str:
    return f"[run log]({s.run_url})"
