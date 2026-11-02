#!/usr/bin/env bash
# Starts issues that wait for overlapping work (agent:waiting, set by the Architect workflow when
# overlap.sh found in-flight work on the same files) once nothing they overlap is in flight any more.
# Oldest first, one at a time: an issue started here counts as in flight for the ones after it, so two
# waiting issues that overlap each other don't start together. After AGENT_CONFLICT_WAIT_MINUTES
# (default 120) an issue starts anyway: waiting is an optimization, never a reason to get stuck.
# Runs after every merge (the Integrator) and on every watchdog check (PRs closed without merging,
# items that went to a human).
#
# Usage: release-waiting.sh
# Needs GH_TOKEN, GITHUB_REPOSITORY and AGENT_BOT_ID. Never fails the caller.
set -uo pipefail

repo="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY must be set}"
here="$(dirname "$0")"
max="${AGENT_CONFLICT_WAIT_MINUTES:-120}"

waiting=$(gh api --paginate --slurp "repos/$repo/issues?state=open&per_page=100" \
  | jq -r '[.[][] | select(.pull_request | not) | select(any(.labels[]; .name == "agent:waiting")) | .number] | sort | .[]') || exit 0

for n in $waiting; do
  at=$(gh api --paginate --slurp "repos/$repo/issues/$n/events" \
    | jq -r '[.[][] | select(.event == "labeled" and .label.name == "agent:waiting")] | last | .created_at // empty') || continue
  since=$(date -u -d "${at:-now}" +%s 2>/dev/null || date -u -j -f '%Y-%m-%dT%H:%M:%SZ' "$at" +%s 2>/dev/null || date -u +%s)
  waited=$(( ($(date -u +%s) - since) / 60 ))
  if ! blockers=$("$here/overlap.sh" "$n"); then
    echo "#$n: couldn't check the overlap, trying again later"; continue
  fi
  if [ -n "$blockers" ] && [ "$waited" -lt "$max" ]; then
    echo "#$n still waits (${waited}m): $(echo "$blockers" | cut -d' ' -f1 | tr '\n' ' ')"
    continue
  fi
  if [ -n "$blockers" ]; then
    why="it waited ${waited} minutes (\`AGENT_CONFLICT_WAIT_MINUTES\` = $max), so it starts anyway. Expect conflicts with $(echo "$blockers" | cut -d' ' -f1 | tr '\n' ' ')"
  else
    why="nothing in flight touches its planned files any more"
  fi
  "$here/transition.sh" "$n" agent:ready >/dev/null || continue
  gh issue comment "$n" -R "$repo" --body "▶️ **Conflict avoidance:** $why. Starting the implementation from the latest code." >/dev/null || true
  "$here/progress.sh" "$n" "▶️ **Conflict avoidance**: no longer waiting, implementing" || true
  echo "#$n released: $why"
done
exit 0
