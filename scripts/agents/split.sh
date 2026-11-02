#!/usr/bin/env bash
# Splits a parent issue into sub-issues, following the Architect's plan.
# Each sub-issue gets the plan's acceptance criteria as an `agent:analyst` comment, so every
# later role works on it exactly as on a normal issue. Sub-issues without dependencies go
# straight to the Architect (`agent:analyzed`); the others wait in `agent:blocked` until
# subissues.sh unblocks them.
#
# Usage: split.sh <parent> <plan.json>
#   plan.json: {"subtasks":[{"title":"…","summary":"…","acceptance_criteria":["…"],"depends_on":[1]}]}
#   depends_on holds 1-based positions of *earlier* subtasks, which keeps the graph acyclic.
# Needs GH_TOKEN and GITHUB_REPOSITORY. AGENT_MAX_SUBISSUES caps the split (default 5).
set -euo pipefail

parent="$1"
plan="$2"
repo="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY must be set}"
here="$(dirname "$0")"
max="${AGENT_MAX_SUBISSUES:-5}"
work="$(mktemp -d)"

count=$(jq '.subtasks | length' "$plan")
if [ "$count" -lt 2 ] || [ "$count" -gt "$max" ]; then
  echo "::error::Split plan has $count subtasks; expected 2 to $max"; exit 1
fi
bad=$(jq '[.subtasks | to_entries[] | .key as $i | (.value.depends_on // [])[] | select(. < 1 or . > $i)] | length' "$plan")
if [ "$bad" != "0" ]; then
  echo "::error::Split plan has $bad dependencies that don't point to an earlier subtask"; exit 1
fi

gh label create "agent:split" -R "$repo" --color "bfdadc" --description "Split into sub-issues; closes when all are done" --force >/dev/null
gh label create "agent:blocked" -R "$repo" --color "e4e669" --description "Sub-issue waiting for the sub-issues it depends on" --force >/dev/null

nums='[]'
rows=""
for i in $(seq 0 $((count - 1))); do
  task=$(jq -c ".subtasks[$i]" "$plan")
  title=$(echo "$task" | jq -r .title)
  deps=$(echo "$task" | jq -r --argjson nums "$nums" '[(.depends_on // [])[] | $nums[. - 1] | tostring] | join(",")')
  deps_text=$(echo "$deps" | sed -E 's/([0-9]+)/#\1/g; s/,/, /g')

  {
    echo "$task" | jq -r .summary
    echo
    echo "Part of #$parent."
    [ -n "$deps" ] && echo "Depends on: $deps_text (starts when they are done)."
    echo
    echo "<!-- agent:sub-issue parent=$parent depends=$deps -->"
  } > "$work/body.md"
  url=$(gh issue create -R "$repo" --title "$title" --body-file "$work/body.md")
  n="${url##*/}"
  nums=$(echo "$nums" | jq -c ". + [$n]")
  echo "Created #$n: $title"

  {
    echo "<!-- agent:analyst -->"
    echo "## 🔍 Analyst"
    echo
    echo "_Split from #$parent by the Architect. The parent's \`agent:architect\` comment holds the overall design._"
    echo
    echo "**Problem statement**"
    echo "$task" | jq -r .summary
    echo
    echo "**Acceptance criteria**"
    echo "$task" | jq -r '.acceptance_criteria[] | "- [ ] \(.)"'
    echo
    echo "**Out of scope**"
    echo "- The other parts of #$parent, each handled in its own sub-issue."
  } > "$work/analysis.md"
  gh issue comment "$n" -R "$repo" --body-file "$work/analysis.md" >/dev/null

  # Link as a real GitHub sub-issue (shows progress on the parent). Best effort: the markers are the source of truth.
  id=$(gh api "repos/$repo/issues/$n" --jq .id)
  gh api -X POST "repos/$repo/issues/$parent/sub_issues" -F "sub_issue_id=$id" >/dev/null 2>&1 \
    || echo "::warning::Could not link #$n as a sub-issue of #$parent"

  if [ -z "$deps" ]; then
    "$here/transition.sh" "$n" agent:analyzed >/dev/null
    rows="$rows- [ ] #$n $title (starts now)"$'\n'
  else
    "$here/transition.sh" "$n" agent:blocked >/dev/null
    rows="$rows- [ ] #$n $title (waits for $deps_text)"$'\n'
  fi
done

{
  echo "<!-- agent:split $(echo "$nums" | jq -r 'join(",")') -->"
  echo "## 🧩 Split into $count sub-issues"
  echo
  printf '%s' "$rows"
  echo
  echo "Each sub-issue goes through the pipeline on its own (design, PR, review, QA, merge). Independent ones run in parallel."
  echo "This issue closes automatically when all of them are done."
} > "$work/split.md"
gh issue comment "$parent" -R "$repo" --body-file "$work/split.md" >/dev/null
"$here/transition.sh" "$parent" agent:split >/dev/null
echo "Split #$parent into $(echo "$nums" | jq -r 'map("#\(.)") | join(", ")')"
