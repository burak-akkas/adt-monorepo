#!/bin/sh
# Usage: approved-sha.sh <pr>
# Implemented in Python: scripts/agents/agentflow (`approved-sha` command). This wrapper keeps the script's name for the workflows.
exec python3 -I "$(dirname "$0")/agentflow" approved-sha "$@"
