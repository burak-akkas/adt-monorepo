#!/bin/sh
# Usage: own-diff.sh <base-ref> <sha>
# Implemented in Python: scripts/agents/agentflow (`own-diff` command). This wrapper keeps the script's name for the workflows.
exec python3 -I "$(dirname "$0")/agentflow" own-diff "$@"
