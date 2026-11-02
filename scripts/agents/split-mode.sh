#!/bin/sh
# Usage: split-mode.sh <issue>
# Implemented in Python: scripts/agents/agentflow (`split-mode` command). This wrapper keeps the script's name for the workflows.
exec python3 -I "$(dirname "$0")/agentflow" split-mode "$@"
