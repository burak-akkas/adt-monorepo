#!/usr/bin/env bash
# Prints how many comments on an issue/PR carry a role's handoff marker.
# Workflows compare the count before and after a run to verify the agent posted its comment.
#
# Usage: count-comments.sh <issue-or-pr-number> <role>   # e.g. count-comments.sh 42 analyst
set -euo pipefail

n="$1"
role="$2"
repo="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY must be set}"

# Only the agents' own comments count, so outsiders can't forge markers. Matched by user id, which survives App renames.
bot="${AGENT_BOT_ID:?AGENT_BOT_ID must be set}"

gh api --paginate "repos/$repo/issues/$n/comments" \
  --jq ".[] | select(.user.id == $bot and (.body | contains(\"<!-- agent:$role -->\"))) | .id" | wc -l | tr -d ' '
