"""The labels the agent team works with: one agent:* state per issue or PR, and the design's risk."""

from __future__ import annotations

from dataclasses import dataclass

from agentflow.github import GitHub


@dataclass(frozen=True)
class Label:
    name: str
    color: str
    description: str


LABELS: tuple[Label, ...] = (
    # Issue states
    Label("agent:start", "ededed", "Ask the Analyst agent to pick up this issue"),
    Label("agent:needs-info", "fbca04", "Analyst is waiting for answers from a human"),
    Label("agent:analyzed", "c5def5", "Analysis done, Architect agent picks it up"),
    Label("agent:design-review", "d4c5f9", "Design waiting for human approval (apply agent:ready to approve)"),
    Label("agent:ready", "0e8a16", "Approved for implementation, Implementor agent picks it up"),
    Label("agent:waiting", "fef2c0", "Waits for in-flight work on the same files to merge first, then starts"),
    Label("agent:in-progress", "1d76db", "Implementor agent is working"),
    Label("agent:pr-open", "5319e7", "A PR is open for this issue"),
    Label("agent:out-of-scope", "cccccc", "Analyst judged this not actionable"),
    Label("agent:split", "bfdadc", "Split into sub-issues; closes when all are done"),
    Label("agent:blocked", "e4e669", "Waiting for the issues it depends on; starts when they close"),
    # PR states
    Label("agent:review", "c2e0c6", "Ask the Reviewer agent to review this PR"),
    Label("agent:changes-requested", "e99695", "Reviewer requested changes, Implementor agent fixes them"),
    Label("agent:fixing", "fbca04", "The Implementor agent is working on this PR now"),
    Label("agent:qa", "bfd4f2", "QA agent tests the PR preview in a browser"),
    Label("agent:approved", "0e8a16", "Approved; the merge gate admits it to the merge queue"),
    Label("agent:queued", "fef2c0", "In the merge queue; the Integrator merges queued PRs one at a time"),
    Label("agent:integrating", "1d76db", "The Integrator is updating, testing and merging this PR now"),
    # Both
    Label("agent:needs-decision", "f9d0c4", "Team is stuck; the Lead agent decides"),
    Label("agent:needs-human", "b60205", "Escalated by the Lead; a human must decide"),
    Label("agent:done", "0e8a16", "Merged by the agent team"),
    # Risk recorded by the Architect (read by the merge gate)
    Label("risk:low", "c2e0c6", "Architect: low risk"),
    Label("risk:medium", "fbca04", "Architect: medium risk"),
    Label("risk:high", "b60205", "Architect: high risk; a human merges"),
)
BY_NAME = {label.name: label for label in LABELS}


def ensure(gh: GitHub, *names: str) -> None:
    """Creates (or updates) these labels."""
    for name in names:
        label = BY_NAME[name]
        gh.create_label(label.name, label.color, label.description)


def setup(gh: GitHub) -> None:
    """Creates (or updates) every label in a repository."""
    ensure(gh, *BY_NAME)
