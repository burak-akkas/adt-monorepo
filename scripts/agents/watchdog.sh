#!/usr/bin/env bash
# Finds agent work that stalled: an issue or PR sits in a state where an agent should be
# working, the state is older than any run can take, and no agent run is active for it.
# That happens when a run is cancelled, times out, or crashes before its state transition.
#   - re-applies the state label, so the workflow for that state runs again
#     (an issue stuck in agent:in-progress restarts from agent:ready, or moves to
#     agent:pr-open if the Implementor already opened its PR)
#   - restarts the merge queue when PRs wait in agent:queued/agent:integrating but no Integrator run
#     is queued or running (only with AGENT_AUTO_MERGE == 'true')
#   - after AGENT_WATCHDOG_RETRIES retries (default 2) since the last Lead decision it hands the
#     item to the Lead; if the Lead itself is what stalls, to a human
#
# Usage: watchdog.sh [--dry-run]
# Needs GH_TOKEN (the App token, so label events trigger workflows), GITHUB_REPOSITORY, AGENT_BOT_ID.
# AGENT_WATCHDOG_MINUTES (default 10): items with a queued or running agent run are never touched,
# so the threshold only has to cover the gap between a label change and its run starting.
set -euo pipefail

dry="${1:-}"
repo="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY must be set}"
bot="${AGENT_BOT_ID:?AGENT_BOT_ID must be set}"
minutes="${AGENT_WATCHDOG_MINUTES:-10}"
retries="${AGENT_WATCHDOG_RETRIES:-2}"
here="$(dirname "$0")"
now=$(date -u +%s)

# Titles of active agent runs (run titles are the issue or PR title).
active=$(for s in queued in_progress waiting pending; do
  gh run list -R "$repo" --status "$s" --limit 100 --json name,displayTitle \
    --jq '.[] | select(.name | startswith("Agent")) | .displayTitle'
done)

act() { if [ "$dry" = "--dry-run" ]; then echo "  would run: $*"; else "$@"; fi; }

stalled=0
while IFS=$'\t' read -r n kind updated title labels; do
  [ -z "$n" ] && continue
  state=$(echo "$labels" | tr ',' '\n' | grep -m1 -xE "$( [ "$kind" = pr ] \
    && echo 'agent:(review|qa|approved|changes-requested|fixing|needs-decision)' \
    || echo 'agent:(start|analyzed|ready|in-progress|needs-decision)')" || true)
  if [ -z "$state" ]; then
    # An agent PR without any agent:* label is waiting for the Reviewer (it fires on every push).
    [ "$kind" = pr ] || continue
    echo "$labels" | grep -q 'agent:' && continue
    [[ "$(gh api "repos/$repo/pulls/$n" --jq .head.ref)" == agent/* ]] || continue
    state=none
    since=$(date -u -d "$updated" +%s 2>/dev/null || date -u -j -f '%Y-%m-%dT%H:%M:%SZ' "$updated" +%s)
  else
    at=$(gh api --paginate --slurp "repos/$repo/issues/$n/events" \
      | jq -r --arg l "$state" '[.[][] | select(.event == "labeled" and .label.name == $l)] | last | .created_at // empty')
    [ -z "$at" ] && continue
    since=$(date -u -d "$at" +%s 2>/dev/null || date -u -j -f '%Y-%m-%dT%H:%M:%SZ' "$at" +%s)
  fi
  age=$(( (now - since) / 60 ))
  [ "$age" -lt "$minutes" ] && continue
  if printf '%s\n' "$active" | grep -qxF -- "$title"; then
    echo "#$n $state for ${age}m, but an agent run is active: waiting"; continue
  fi

  stalled=$((stalled + 1))
  done_before=$(gh api --paginate --slurp "repos/$repo/issues/$n/comments" | jq --argjson bot "$bot" '[.[][] | select(.user.id == $bot)] as $c
    | ([$c | to_entries[] | select(.value.body | contains("<!-- agent:lead -->")) | .key] | max // -1) as $last
    | [$c | to_entries[] | select(.key > $last and (.value.body | contains("<!-- agent:watchdog -->")))] | length')
  echo "#$n ($kind) stalled in ${state} for ${age}m, retries so far: $done_before"
  ref=$([ "$kind" = pr ] && echo "--pr $n" || echo "$n")

  if [ "$done_before" -ge "$retries" ]; then
    if [ "$state" = "agent:needs-decision" ]; then next=agent:needs-human; who="a human"; else next=agent:needs-decision; who="the Lead"; fi
    act "$here/transition.sh" "$n" "$next"
    act gh issue comment "$n" -R "$repo" --body "<!-- agent:watchdog-escalation -->
⏰ Still no progress in \`${state}\` after $retries watchdog retries. Handing to $who."
    act "$here/progress.sh" $ref "⏰ **Watchdog**: stalled in \`${state}\` after $retries retries, handed to $who"
    continue
  fi

  next="$state"
  note="Re-triggering it"; short="re-triggered"
  case "$state" in
    none) next=agent:review; note="Asking the Reviewer"; short="asked the Reviewer" ;;
    agent:fixing) next=agent:changes-requested; note="Restarting the Implementor"; short="restarted the Implementor" ;;
    agent:in-progress)
      pr=$(gh pr list -R "$repo" --head "agent/issue-$n" --state open --json number --jq '.[0].number // empty')
      if [ -n "$pr" ]; then next=agent:pr-open; note="The Implementor had already opened #$pr, so continuing with it"; short="continuing with #$pr"
      else next=agent:ready; note="Restarting the Implementor"; short="restarted the Implementor"; fi ;;
  esac
  act "$here/transition.sh" "$n" "$next"
  act gh issue comment "$n" -R "$repo" --body "<!-- agent:watchdog -->
⏰ No progress for ${age} minutes in \`${state/none/review pending}\`, and no agent run is active. The last run was probably cancelled or crashed. $note (retry $((done_before + 1)) of $retries)."
  act "$here/progress.sh" $ref "⏰ **Watchdog**: stalled ${age}m in \`${state/none/review pending}\`, $short (retry $((done_before + 1))/$retries)"
# Draft PRs are paused on purpose (agents ignore them), so they never count as stalled.
done < <(gh api --paginate --slurp "repos/$repo/issues?state=open&per_page=100" | jq -r '.[][] | select((.draft // false) | not) |
  [.number, (if .pull_request then "pr" else "issue" end), .updated_at, .title, ([.labels[].name] | join(",") | if . == "" then "-" else . end)] | @tsv')

echo "Stalled items: $stalled"

# Conflict avoidance: issues waiting for overlapping work start once it merged or closed, or waited too long.
if [ "${AGENT_AVOID_CONFLICTS:-}" != false ] && [ "$dry" != "--dry-run" ]; then "$here/release-waiting.sh"; fi

# The merge queue: queued PRs wait on purpose, but only while an Integrator run is queued or running
# (each run drains the whole queue). Without one, e.g. after a cancelled run, re-applying agent:queued
# to the front PR starts one; the PR keeps its place (queue.sh orders by the admission comment).
if [ "${AGENT_AUTO_MERGE:-}" = "true" ]; then
  [ "$dry" = "--dry-run" ] || "$here/queue-tidy.sh"
  queue=$("$here/queue.sh")
  if [ -n "$queue" ]; then
    busy=$(for s in queued in_progress waiting pending requested; do
      gh run list -R "$repo" --workflow agent-integrator.yml --status "$s" --limit 5 --json databaseId --jq length
    done | awk '{ n += $1 } END { print n + 0 }')
    size=$(printf '%s\n' "$queue" | wc -l | tr -d ' ')
    if [ "$busy" -gt 0 ]; then
      echo "Merge queue: $size PR(s), an Integrator run is active"
    else
      front=$(printf '%s\n' "$queue" | head -1 | cut -d' ' -f1)
      echo "Merge queue: $size PR(s) but no Integrator run, restarting it at #$front"
      act "$here/transition.sh" "$front" agent:queued
      act "$here/progress.sh" --pr "$front" "⏰ **Watchdog**: the merge queue had no Integrator run, restarted it"
    fi
  fi
fi
