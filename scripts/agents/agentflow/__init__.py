"""The agent team's tooling, in Python (formerly shell scripts in scripts/agents).

Layers, each using only the ones above it:
  model     plain records (Issue, Comment, LabelEvent)
  config    settings from the environment
  github    the GitHub interface, implemented with the `gh` CLI
  markers   the `<!-- agent:… -->` handoff markers in the bot's comments
  states    an item's agent:* state and its progress log
  issues    the issue pipeline: Lead budget, splitting, sub-issues, dependencies
  cli       one command per former script

Tests: scripts/agents/tests (unit, in-memory GitHub) and scripts/sim (parity with the bash versions,
scenarios and the simulation matrix, through the real workflows and a fake `gh`).
"""
