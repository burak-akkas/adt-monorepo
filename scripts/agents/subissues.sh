#!/bin/sh
# Usage: subissues.sh <closed-sub-issue>   # advance the parent of a sub-issue that just closed
# Implemented in Python: scripts/agents/agentflow (`subissues` command). This wrapper keeps the script's name for the workflows.
exec python3 -I "$(dirname "$0")/agentflow" subissues "$@"
