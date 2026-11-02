#!/bin/sh
# Usage: split.sh <parent> <plan.json>
# Implemented in Python: scripts/agents/agentflow (`split` command). This wrapper keeps the script's name for the workflows.
exec python3 -I "$(dirname "$0")/agentflow" split "$@"
