#!/bin/sh
# Usage: transition.sh <issue-or-pr-number> [new-label]
# Implemented in Python: scripts/agents/agentflow (`transition` command). This wrapper keeps the script's name for the workflows.
exec python3 -I "$(dirname "$0")/agentflow" transition "$@"
