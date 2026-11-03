#!/bin/sh
# Usage: pr-paths.sh required <pr> | pr-paths.sh touches <pr> <prefix|prefix…>
# Implemented in Python: scripts/agents/agentflow (`pr-paths` command). This wrapper keeps the script's name for the workflows.
exec python3 -I "$(dirname "$0")/agentflow" pr-paths "$@"
