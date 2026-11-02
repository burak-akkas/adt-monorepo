#!/usr/bin/env bash
# Tells whether this PR's own changes already got past QA, so the merge queue doesn't test them again.
# The latest of these decides:
#   - a QA report (`<!-- agent:qa -->`): only a pass counts
#   - a Lead decision that approved (`<!-- agent:lead -->` with an approval marker): the Lead may
#     approve over QA's verdict, or without QA, as before QA moved into the queue
#   - a human's approval (the merge gate's `<!-- agent:queued -->` comment with an approval marker)
# and the commit it approved (its `<!-- agent:approved-sha -->` marker) must be <head>, or make exactly
# the same own edits as <head> (own-diff.sh): then only code from the base branch changed around them,
# and CI tests that combination.
#
# Usage: qa-passed.sh <pr> <head-sha>
#   exit 0 and print that approved sha if so, exit 1 otherwise
# Only the agents' own comments count. Needs GH_TOKEN, GITHUB_REPOSITORY and AGENT_BOT_ID.
set -euo pipefail

pr="$1"
head="$2"
repo="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY must be set}"
bot="${AGENT_BOT_ID:?AGENT_BOT_ID must be set}"
here="$(dirname "$0")"

latest=$(gh api --paginate --slurp "repos/$repo/issues/$pr/comments" \
  | jq -r --argjson bot "$bot" '[.[][] | select(.user.id == $bot) | .body
      | select(contains("<!-- agent:qa -->")
               or ((contains("<!-- agent:lead -->") or contains("<!-- agent:queued -->")) and test("<!-- agent:approved-sha [0-9a-f]{40} -->")))]
      | last // empty')
[ -n "$latest" ] || exit 1
if grep -qF '<!-- agent:qa -->' <<<"$latest"; then
  grep -qE '\*\*Verdict:\*\*[[:space:]]*pass' <<<"$latest" || exit 1
fi
passed=$(grep -oE '<!-- agent:approved-sha [0-9a-f]{40} -->' <<<"$latest" | tail -1 | grep -oE '[0-9a-f]{40}' || true)
[ -n "$passed" ] || exit 1
if [ "$passed" = "$head" ]; then echo "$passed"; exit 0; fi

base=$(gh pr view "$pr" -R "$repo" --json baseRefName --jq .baseRefName)
before=$("$here/own-diff.sh" "$base" "$passed") || exit 1
after=$("$here/own-diff.sh" "$base" "$head") || exit 1
[ "$before" = "$after" ] || exit 1
echo "$passed"
