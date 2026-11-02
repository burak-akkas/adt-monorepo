#!/usr/bin/env bash
# Prints how many Lead decisions count against the Lead's budget on an issue or PR:
# the bot's `<!-- agent:lead -->` comments made since the item was last escalated to a human
# (labeled `agent:needs-human`). An escalation hands the item to a human; when they send it back to
# the team, the Lead starts with a fresh budget instead of escalating again straight away.
# Only a human can take an item out of `agent:needs-human` (no workflow does), so this can't loop.
#
# Usage: lead-budget.sh <issue-or-pr-number>
# Needs GH_TOKEN, GITHUB_REPOSITORY and AGENT_BOT_ID.
set -euo pipefail

n="$1"
repo="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY must be set}"
bot="${AGENT_BOT_ID:?AGENT_BOT_ID must be set}"

since=$(gh api --paginate --slurp "repos/$repo/issues/$n/events" \
  | jq -r '[.[][] | select(.event == "labeled" and .label.name == "agent:needs-human") | .created_at] | max // ""')

gh api --paginate --slurp "repos/$repo/issues/$n/comments" \
  | jq --argjson bot "$bot" --arg since "$since" \
      '[.[][] | select(.user.id == $bot and ((.body // "") | contains("<!-- agent:lead -->")) and .created_at > $since)] | length'
