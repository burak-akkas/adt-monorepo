#!/bin/sh
# Usage: release-waiting.sh
# Implemented in Python: scripts/agents/agentflow (`release-waiting` command). This wrapper keeps the script's name for the workflows.
exec python3 -I "$(dirname "$0")/agentflow" release-waiting "$@"
