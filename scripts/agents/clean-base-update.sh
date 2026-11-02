#!/usr/bin/env bash
# Tells whether a PR's head commit is only GitHub's clean merge of the base branch on top of the
# commit the agents last approved, i.e. what the Integrator's update-branch creates. Then the PR's
# own changes are exactly what was reviewed and re-reviewing them adds nothing (QA still tests the
# combined code).
#
# Usage: clean-base-update.sh <pr> <head-sha>
#   exit 0 and print the approved sha if so, exit 1 otherwise
# A hand-made merge commit never qualifies: it must be authored by the agents' bot, committed by
# GitHub (web-flow) with a valid signature, have the approved commit as first parent, and merge in a
# commit that is already on the base branch.
# Needs GH_TOKEN, GITHUB_REPOSITORY and AGENT_BOT_ID.
set -euo pipefail

pr="$1"
head="$2"
repo="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY must be set}"
bot="${AGENT_BOT_ID:?AGENT_BOT_ID must be set}"

approved=$("$(dirname "$0")/approved-sha.sh" "$pr")
[ -n "$approved" ] || exit 1

commit=$(gh api "repos/$repo/commits/$head")
printf '%s' "$commit" | jq -e --arg a "$approved" --argjson bot "$bot" '
  (.parents | length) == 2 and .parents[0].sha == $a
  and .author.id == $bot and .committer.login == "web-flow"
  and .commit.verification.verified == true' >/dev/null || exit 1

base=$(gh pr view "$pr" -R "$repo" --json baseRefName --jq .baseRefName)
merged_in=$(printf '%s' "$commit" | jq -r '.parents[1].sha')
case "$(gh api "repos/$repo/compare/$merged_in...$base" --jq .status)" in
  identical|ahead) echo "$approved" ;;
  *) exit 1 ;;
esac
