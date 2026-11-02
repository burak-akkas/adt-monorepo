#!/bin/sh
# Usage: count-comments.sh <issue-or-pr-number> <role>   # e.g. count-comments.sh 42 analyst
# Implemented in Python: scripts/agents/agentflow (`count-comments` command). This wrapper keeps the script's name for the workflows.
exec python3 -I "$(dirname "$0")/agentflow" count-comments "$@"
