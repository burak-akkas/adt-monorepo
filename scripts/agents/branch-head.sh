#!/bin/sh
# Usage: branch-head.sh <branch>
# Implemented in Python: scripts/agents/agentflow (`branch-head` command). This wrapper keeps the script's name for the workflows.
exec python3 -I "$(dirname "$0")/agentflow" branch-head "$@"
