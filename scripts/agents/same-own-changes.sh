#!/bin/sh
# Usage: same-own-changes.sh <pr> <head-sha> [interdiff-file]
# Implemented in Python: scripts/agents/agentflow (`same-own-changes` command). This wrapper keeps the script's name for the workflows.
exec python3 -I "$(dirname "$0")/agentflow" same-own-changes "$@"
