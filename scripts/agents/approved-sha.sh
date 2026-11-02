#!/usr/bin/env bash
# Prints the commit the agents last approved on a PR (the `<!-- agent:approved-sha <sha> -->` marker
# that approve.sh, the merge gate and the Integrator write), or nothing if there is none.
# Only the agents' own comments count, so nobody else can forge an approval.
#
# Usage: approved-sha.sh <pr>
# Needs GH_TOKEN, GITHUB_REPOSITORY and AGENT_BOT_ID.
set -euo pipefail

pr="$1"
repo="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY must be set}"
bot="${AGENT_BOT_ID:?AGENT_BOT_ID must be set}"

gh api --paginate --slurp "repos/$repo/issues/$pr/comments" \
  | jq -r --argjson bot "$bot" '[.[][] | select(.user.id == $bot) | .body
      | capture("<!-- agent:approved-sha (?<s>[0-9a-f]{40}) -->").s] | last // empty'
