#!/bin/sh
# The agent team's tooling, one entry point for every workflow step:
#   scripts/agents/agent.sh <command> [args]      (agent.sh --help lists the commands)
# The code is the Python package next to this file (scripts/agents/agentflow, see README.md). -I keeps
# PYTHON* variables and user site-packages out, so only that code runs.
exec python3 -I "$(dirname "$0")/agentflow" "$@"
