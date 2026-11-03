#!/bin/sh
# Usage: qa-passed.sh <pr> <head-sha>
# Implemented in Python: scripts/agents/agentflow (`qa-passed` command). This wrapper keeps the script's name for the workflows.
exec python3 -I "$(dirname "$0")/agentflow" qa-passed "$@"
