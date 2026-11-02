#!/usr/bin/env bash
# Prints the merge queue, front first: one "<pr> <state>" line per open PR that is being merged
# (agent:integrating, always first) or waiting (agent:queued, oldest admission first).
#
# A PR's place comes from the merge gate's `<!-- agent:queued -->` admission comment, not from the
# label, so re-applying agent:queued (the watchdog and the Integrator do that to start a new
# Integrator run) keeps the PR's place. A PR that is sent back and approved again gets a new
# admission comment, so it rejoins at the back.
#
# Usage: queue.sh
# Needs GH_TOKEN, GITHUB_REPOSITORY and AGENT_BOT_ID.
set -euo pipefail

repo="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY must be set}"
bot="${AGENT_BOT_ID:?AGENT_BOT_ID must be set}"

for label in agent:integrating agent:queued; do
  rank=$([ "$label" = agent:integrating ] && echo 0 || echo 1)
  for n in $(gh pr list -R "$repo" --state open --label "$label" --limit 100 --json number,isDraft \
               --jq '.[] | select(.isDraft | not) | .number'); do
    # No admission comment (e.g. a human applied the label by hand): last in line.
    at=$(gh api --paginate --slurp "repos/$repo/issues/$n/comments" \
      | jq -r --argjson bot "$bot" '[.[][] | select(.user.id == $bot and (.body | contains("<!-- agent:queued -->"))) | .created_at]
          | last // "9999-12-31T23:59:59Z"')
    printf '%s\t%s\t%s\t%s\n' "$rank" "$at" "$n" "${label#agent:}"
  done
done | sort -t $'\t' -k1,1n -k2,2 -k3,3n | awk -F '\t' '!seen[$3]++ { print $3, $4 }'
