#!/bin/sh
# Usage: lead-budget.sh <issue-or-pr-number>
# Implemented in Python: scripts/agents/agentflow (`lead-budget` command). This wrapper keeps the script's name for the workflows.
exec python3 -I "$(dirname "$0")/agentflow" lead-budget "$@"
