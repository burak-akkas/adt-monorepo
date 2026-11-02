#!/usr/bin/env bash
# After a merge, sends the open agent PRs that now conflict with the base branch to the Implementor.
# GitHub runs no pull_request workflows (CI, preview) for conflicting PRs, so they would stall.
# Queued PRs are included: the Implementor can resolve the conflict while the queue moves on,
# instead of when the PR reaches the front.
# Skips PRs that already wait for the Implementor, the Lead or a human, the PR the Integrator is
# merging right now, and PRs an Implementor run is already working on (agent:fixing, or a queued run):
# it merges the latest base right before pushing, so flagging the PR again would only queue a second
# run that finds nothing to do.
#
# Usage: sweep-conflicts.sh <merged-pr> <base-branch>
# Needs GH_TOKEN, GITHUB_REPOSITORY. Never fails the caller.
set -uo pipefail

merged="$1"
base="$2"
repo="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY must be set}"
here="$(dirname "$0")"

sleep 20   # give GitHub time to recompute mergeability after the merge
# Whether an Implementor run is queued or in progress for a PR (run titles are the PR title). Asked
# right before flagging each PR, not once up front: checking the PRs takes a while, and another run
# (e.g. a Reviewer or QA run that found the conflict) can start the Implementor meanwhile.
implementor_busy() {   # <pr title>
  for s in queued in_progress waiting pending requested; do
    gh run list -R "$repo" --workflow agent-implementor.yml --status "$s" --limit 50 --json displayTitle --jq '.[].displayTitle' 2>/dev/null
  done | grep -qxF -- "$1"
}
for n in $(gh pr list -R "$repo" --state open --base "$base" --json number,headRefName \
             --jq '.[] | select(.headRefName | startswith("agent/")) | .number'); do
  state=UNKNOWN
  for _ in 1 2 3 4 5; do
    state=$(gh pr view "$n" -R "$repo" --json mergeable --jq .mergeable)
    [ "$state" != "UNKNOWN" ] && break
    sleep 10
  done
  echo "PR #$n: $state"
  [ "$state" = "CONFLICTING" ] || continue
  view=$(gh pr view "$n" -R "$repo" --json labels,title)
  labels=$(jq -r '[.labels[].name] | join(",")' <<<"$view")
  case ",$labels," in
    *",agent:changes-requested,"*|*",agent:fixing,"*|*",agent:needs-decision,"*|*",agent:needs-human,"*|*",agent:integrating,"*) continue ;;
  esac
  if implementor_busy "$(jq -r .title <<<"$view")"; then
    echo "PR #$n: the Implementor is already working on it"
    continue
  fi
  "$here/transition.sh" "$n" agent:changes-requested >/dev/null
  gh pr comment "$n" -R "$repo" --body "<!-- agent:merge -->
⚠️ #$merged was just merged into \`$base\`, and this PR now **conflicts** with it.$([[ ",$labels," == *",agent:queued,"* ]] && echo " It leaves the merge queue until that's resolved.") Implementor: run \`git fetch origin $base\` and \`git merge origin/$base\`, resolve the conflicts keeping the intent of both changes, run all checks, and push." >/dev/null
  "$here/progress.sh" --pr "$n" "🚦 **Merge queue**: #$n conflicts with the just-merged #$merged, back to the Implementor"
done
exit 0
