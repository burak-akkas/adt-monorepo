#!/usr/bin/env bash
# Says whether the Architect may, must or must not split an issue into sub-issues.
#
#   allowed       the Architect decides (too big for one PR -> split)
#   required      the Lead chose `split`, or the size check found the design too big, after the latest
#                 design: the Architect must split (a bot `<!-- agent:split-required -->` comment that is
#                 newer than the latest `<!-- agent:architect -->` comment)
#   not-allowed   splitting is off (AGENT_SPLIT == 'false') or the issue is already
#                 AGENT_MAX_SPLIT_DEPTH levels deep (default 2: an issue and its sub-issues can split,
#                 sub-sub-issues can't). Followed by the reason on the same line.
#
# The depth follows the `<!-- agent:sub-issue parent=P -->` markers of issues the bot created, so
# nobody can fake or hide a parent by editing an issue body.
#
# Usage: split-mode.sh <issue>
# Needs GH_TOKEN, GITHUB_REPOSITORY and AGENT_BOT_ID.
set -euo pipefail

n="$1"
repo="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY must be set}"
bot="${AGENT_BOT_ID:?AGENT_BOT_ID must be set}"
max_depth="${AGENT_MAX_SPLIT_DEPTH:-2}"

if [ "${AGENT_SPLIT:-}" = "false" ]; then
  echo "not-allowed splitting is turned off (AGENT_SPLIT)"; exit 0
fi

depth=0
cur="$n"
while [ "$depth" -lt 10 ]; do
  parent=$(gh api "repos/$repo/issues/$cur" | jq -r --argjson bot "$bot" \
    'select(.user.id == $bot) | (.body // "") | capture("<!-- agent:sub-issue parent=(?<p>[0-9]+)").p // empty')
  [ -z "$parent" ] && break
  depth=$((depth + 1))
  cur="$parent"
done

if [ "$depth" -ge "$max_depth" ]; then
  echo "not-allowed this issue is already $depth level(s) of sub-issues deep (AGENT_MAX_SPLIT_DEPTH is $max_depth)"; exit 0
fi

# Position of the newest split request and of the newest design among the bot's comments.
gh api --paginate --slurp "repos/$repo/issues/$n/comments" | jq -r --argjson bot "$bot" '
  [.[][] | select(.user.id == $bot) | (.body // "")] as $c
  | ([$c | to_entries[] | select(.value | contains("<!-- agent:split-required -->")) | .key] | max // -1) as $req
  | ([$c | to_entries[] | select(.value | contains("<!-- agent:architect -->")) | .key] | max // -1) as $design
  | if $req > $design then "required" else "allowed" end'
