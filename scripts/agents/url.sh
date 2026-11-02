#!/bin/sh
# Usage: url.sh preview <pr> | url.sh production
# Implemented in Python: scripts/agents/agentflow (`url` command). This wrapper keeps the script's name for the workflows.
exec python3 -I "$(dirname "$0")/agentflow" url "$@"
