#!/bin/sh
# Usage: sweep-conflicts.sh <merged-pr> <base-branch>
# Implemented in Python: scripts/agents/agentflow (`sweep-conflicts` command). This wrapper keeps the script's name for the workflows.
exec python3 -I "$(dirname "$0")/agentflow" sweep-conflicts "$@"
