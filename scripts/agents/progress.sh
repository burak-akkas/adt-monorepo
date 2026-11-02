#!/bin/sh
# Usage: progress.sh <issue-number> "<markdown line>"
# Implemented in Python: scripts/agents/agentflow (`progress` command). This wrapper keeps the script's name for the workflows.
exec python3 -I "$(dirname "$0")/agentflow" progress "$@"
