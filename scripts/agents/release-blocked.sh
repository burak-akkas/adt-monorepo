#!/bin/sh
# Usage: release-blocked.sh
# Implemented in Python: scripts/agents/agentflow (`release-blocked` command). This wrapper keeps the script's name for the workflows.
exec python3 -I "$(dirname "$0")/agentflow" release-blocked "$@"
