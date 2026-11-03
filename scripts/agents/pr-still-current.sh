#!/bin/sh
# Usage: pr-still-current.sh <pr> <expected-head-sha> [required-label]
# Implemented in Python: scripts/agents/agentflow (`pr-still-current` command). This wrapper keeps the script's name for the workflows.
exec python3 -I "$(dirname "$0")/agentflow" pr-still-current "$@"
