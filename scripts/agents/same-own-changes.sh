#!/usr/bin/env bash
# Tells whether a PR still makes exactly the edits the agents last approved, i.e. its own
# added/removed lines (own-diff.sh) are unchanged since the approved commit. That is the case after
# the Implementor merged the base branch and resolved conflicts by keeping both sides: only the
# surrounding code changed, and that came from the base branch, which was reviewed in its own PRs.
# CI tests the combination, like after a clean update (clean-base-update.sh).
#
# Usage: same-own-changes.sh <pr> <head-sha> [interdiff-file]
#   exit 0 and print the approved sha if the edits are the same
#   exit 1 otherwise. With an interdiff file and an earlier approval, writes there how the PR's own
#   edits changed since the approved commit (a unified diff of the two own-diff.sh outputs), so a
#   re-review can focus on that.
# Needs GH_TOKEN, GITHUB_REPOSITORY and AGENT_BOT_ID.
set -euo pipefail

pr="$1"
head="$2"
out="${3:-}"
repo="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY must be set}"
here="$(dirname "$0")"

approved=$("$here/approved-sha.sh" "$pr")
[ -n "$approved" ] || exit 1
if [ "$approved" = "$head" ]; then echo "$approved"; exit 0; fi

base=$(gh pr view "$pr" -R "$repo" --json baseRefName --jq .baseRefName)
before=$("$here/own-diff.sh" "$base" "$approved") || exit 1
after=$("$here/own-diff.sh" "$base" "$head") || exit 1

if [ "$before" = "$after" ]; then
  echo "$approved"
  exit 0
fi
if [ -n "$out" ]; then
  diff -u --label "PR edits as approved (${approved:0:7})" --label "PR edits now (${head:0:7})" \
    <(printf '%s\n' "$before") <(printf '%s\n' "$after") > "$out" || true
fi
exit 1
