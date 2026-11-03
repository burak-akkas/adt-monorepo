#!/bin/sh
# Usage: clean-base-update.sh <pr> <head-sha>
# Implemented in Python: scripts/agents/agentflow (`clean-base-update` command). This wrapper keeps the script's name for the workflows.
exec python3 -I "$(dirname "$0")/agentflow" clean-base-update "$@"
