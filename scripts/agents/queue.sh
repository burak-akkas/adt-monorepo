#!/bin/sh
# Usage: queue.sh
# Implemented in Python: scripts/agents/agentflow (`queue` command). This wrapper keeps the script's name for the workflows.
exec python3 -I "$(dirname "$0")/agentflow" queue "$@"
