#!/usr/bin/env bash
# Clears merge-queue state from PRs that are no longer open: a merged PR still labeled
# agent:approved, agent:queued or agent:integrating (e.g. an Integrator run killed right after the
# merge, or an approval that arrived late) becomes agent:done; a closed one loses the label.
# The Integrator runs it at the start of every run, the watchdog on every check.
#
# Usage: queue-tidy.sh
# Needs GH_TOKEN, GITHUB_REPOSITORY. Never fails the caller.
set -uo pipefail

repo="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY must be set}"
here="$(dirname "$0")"

for label in agent:integrating agent:queued agent:approved; do
  rows=$(gh pr list -R "$repo" --state all --label "$label" --limit 100 --json number,state \
           --jq '.[] | select(.state != "OPEN") | "\(.number) \(.state)"') || continue
  while read -r n state; do
    [ -n "$n" ] || continue
    if [ "$state" = MERGED ]; then
      "$here/transition.sh" "$n" agent:done >/dev/null && echo "#$n is merged: $label -> agent:done"
    else
      "$here/transition.sh" "$n" >/dev/null && echo "#$n is closed: removed $label"
    fi
  done <<<"$rows"
done
exit 0
