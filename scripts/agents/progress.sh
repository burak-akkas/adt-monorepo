#!/usr/bin/env bash
# Appends a line to the issue's "📋 Agent progress" comment (created on first use),
# so the issue shows the whole pipeline even when the work happens on the PR.
# Never fails the calling step.
#
# Usage: progress.sh <issue-number> "<markdown line>"
#        progress.sh --pr <pr-number> "<markdown line>"   # resolves the PR's linked issue
set -uo pipefail

repo="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY must be set}"
if [ "$1" = "--pr" ]; then
  issue=$(gh pr view "$2" -R "$repo" --json closingIssuesReferences --jq '.closingIssuesReferences[0].number // empty' 2>/dev/null)
  shift 2
else
  issue="$1"
  shift
fi
line="$1"
[ -z "${issue:-}" ] && exit 0

run="${GITHUB_SERVER_URL:-https://github.com}/$repo/actions/runs/${GITHUB_RUN_ID:-}"
entry="- \`$(date -u +%H:%M)\` $line · [run]($run)"
marker="<!-- agent:progress -->"
bot="${AGENT_BOT_ID:-}"   # matched by user id, which survives App renames

id=$(gh api --paginate "repos/$repo/issues/$issue/comments" \
  --jq ".[] | select((\"$bot\" == \"\" or .user.id == ${bot:-0}) and (.body | startswith(\"$marker\"))) | .id" 2>/dev/null | head -1)

if [ -n "$id" ]; then
  body=$(gh api "repos/$repo/issues/comments/$id" --jq .body 2>/dev/null)
  gh api -X PATCH "repos/$repo/issues/comments/$id" -f body="$body
$entry" >/dev/null 2>&1 || true
else
  gh api "repos/$repo/issues/$issue/comments" -f body="$marker
### 📋 Agent progress
$entry" >/dev/null 2>&1 || true
fi
exit 0
