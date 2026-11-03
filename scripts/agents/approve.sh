#!/bin/sh
# Usage: approve.sh <pr> <approved-sha> <role>   # role: the marker of the approving comment (qa, reviewer, lead)
# Implemented in Python: scripts/agents/agentflow (`approve` command). This wrapper keeps the script's name for the workflows.
exec python3 -I "$(dirname "$0")/agentflow" approve "$@"
