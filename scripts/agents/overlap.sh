#!/bin/sh
# Usage: overlap.sh <issue>
# Implemented in Python: scripts/agents/agentflow (`overlap` command). This wrapper keeps the script's name for the workflows.
exec python3 -I "$(dirname "$0")/agentflow" overlap "$@"
