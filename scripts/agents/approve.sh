#!/usr/bin/env bash
# Approves a PR for the merge gate. Records the exact commit that was approved as a hidden marker
# in the approving agent's latest comment, then applies agent:approved. The merge gate only queues
# that commit, and the Integrator only merges it (or its own clean merge of the base on top of it), so
# commits pushed after the approval (by anyone) go through review again.
#
# Usage: approve.sh <pr> <approved-sha> <role>   # role: the marker of the approving comment (qa, reviewer, lead)
# Needs GH_TOKEN, GITHUB_REPOSITORY and AGENT_BOT_ID.
set -euo pipefail

pr="$1"
sha="$2"
role="$3"
repo="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY must be set}"
bot="${AGENT_BOT_ID:?AGENT_BOT_ID must be set}"
here="$(dirname "$0")"
marker="<!-- agent:approved-sha $sha -->"

id=$(gh api --paginate --slurp "repos/$repo/issues/$pr/comments" \
  | jq -r --argjson bot "$bot" --arg m "<!-- agent:$role -->" '[.[][] | select(.user.id == $bot and (.body | contains($m)))] | last | .id // empty')
if [ -n "$id" ]; then
  body=$(gh api "repos/$repo/issues/comments/$id" --jq .body)
  gh api -X PATCH "repos/$repo/issues/comments/$id" -f body="$body

$marker" >/dev/null
else
  gh pr comment "$pr" -R "$repo" --body "$marker" >/dev/null
fi
"$here/transition.sh" "$pr" agent:approved
