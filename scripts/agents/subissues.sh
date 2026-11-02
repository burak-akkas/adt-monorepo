#!/usr/bin/env bash
# Advances split issues:
#   - unblocks sub-issues whose dependencies are all closed as completed
#   - closes the parent once every sub-issue is completed
#   - hands the parent to the Lead when a sub-issue was closed as not planned
# Only markers written by the agents' bot count, like everywhere else.
#
# Usage: subissues.sh <closed-sub-issue>   # advance the parent of a sub-issue that just closed
#        subissues.sh --sweep              # advance every open split issue
# The sweep makes this self-healing: GitHub keeps one pending run per concurrency group, so a
# run for one closure can be dropped; the next run (or the watchdog) catches up on everything.
# Needs GH_TOKEN, GITHUB_REPOSITORY and AGENT_BOT_ID (the bot's user id; it survives App renames).
set -euo pipefail

repo="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY must be set}"
bot="${AGENT_BOT_ID:?AGENT_BOT_ID must be set}"
here="$(dirname "$0")"

# advance <parent> [<sub-issue that just closed>]
advance() {
  local parent="$1" closed="${2:-}" children completed dropped remaining c s child deps ready

  children=$(gh api --paginate "repos/$repo/issues/$parent/comments" \
    --jq ".[] | select(.user.id == $bot) | (.body // \"\") | capture(\"<!-- agent:split (?<n>[0-9,]+) -->\").n" | tail -1 | tr ',' ' ')
  [ -z "$children" ] && { echo "::warning::#$parent has no split marker"; return 0; }

  # Sub-issues closed as completed / not planned, as " 12 14 " (plain lists keep this portable to bash 3)
  completed=" "; dropped=" "
  for c in $children; do
    s=$(gh api "repos/$repo/issues/$c" --jq '"\(.state) \(.state_reason // "")"')
    case "$s" in
      "closed completed")   completed="$completed$c " ;;
      "closed not_planned") dropped="$dropped$c " ;;
    esac
  done

  if [ "$dropped" != " " ]; then
    # Hand over once: after this the parent is no longer agent:split, so the sweep leaves it alone.
    if gh api "repos/$repo/issues/$parent/labels" --jq '.[].name' | grep -qx 'agent:split'; then
      "$here/transition.sh" "$parent" agent:needs-decision >/dev/null
      gh issue comment "$parent" -R "$repo" --body "⚠️ Sub-issue(s)$(echo "$dropped" | sed -E 's/ ([0-9]+)/ #\1/g')were closed as **not planned**. Sub-issues that depend on them stay blocked. Lead: decide whether to unblock them (apply \`agent:analyzed\`), close them, or close this issue." >/dev/null
      echo "#$parent: sub-issues closed as not planned, handed to the Lead"
    fi
    return 0
  fi

  remaining=0
  for c in $children; do
    [[ "$completed" == *" $c "* ]] && continue
    remaining=$((remaining + 1))
    child=$(gh api "repos/$repo/issues/$c")
    [ "$(echo "$child" | jq -r .state)" = "open" ] || continue
    echo "$child" | jq -e '[.labels[].name] | index("agent:blocked")' >/dev/null || continue
    deps=$(echo "$child" | jq -r '(.body // "") | capture("<!-- agent:sub-issue parent=[0-9]+ depends=(?<d>[0-9,]*)").d // ""' | tr ',' ' ')
    ready=true
    for d in $deps; do [[ "$completed" == *" $d "* ]] || ready=false; done
    if [ "$ready" = "true" ]; then
      "$here/transition.sh" "$c" agent:analyzed >/dev/null
      "$here/progress.sh" "$c" "🧩 **Unblocked**: its dependencies are done, starting design"
      "$here/progress.sh" "$parent" "🧩 ${closed:+#$closed done, }**#$c** unblocked"
      echo "Unblocked #$c"
    fi
  done

  if [ "$remaining" -eq 0 ]; then
    [ "$(gh api "repos/$repo/issues/$parent" --jq .state)" = "open" ] || return 0
    list=$(for c in $children; do printf -- '- #%s\n' "$c"; done)
    gh issue comment "$parent" -R "$repo" --body "✅ All sub-issues are done:
$list

Closing this issue." >/dev/null
    "$here/transition.sh" "$parent" agent:done >/dev/null
    gh issue close "$parent" -R "$repo" --reason completed >/dev/null
    "$here/progress.sh" "$parent" "✅ **All sub-issues done**, closed"
    echo "Closed #$parent"
  elif [ -n "$closed" ]; then
    "$here/progress.sh" "$parent" "🧩 #$closed done, $remaining sub-issue(s) left"
  fi
}

if [ "${1:-}" = "--sweep" ]; then
  for p in $(gh issue list -R "$repo" --state open --label agent:split --limit 100 --json number --jq '.[].number'); do
    advance "$p"
  done
  echo "Swept open split issues"
  exit 0
fi

closed="${1:?usage: subissues.sh <closed-sub-issue> | --sweep}"
issue=$(gh api "repos/$repo/issues/$closed")
if [ "$(echo "$issue" | jq -r .user.id)" != "$bot" ]; then
  echo "#$closed was not created by the agents' bot, nothing to do"; exit 0
fi
parent=$(echo "$issue" | jq -r '(.body // "") | capture("<!-- agent:sub-issue parent=(?<p>[0-9]+)").p // empty')
[ -z "$parent" ] && { echo "#$closed is not a sub-issue"; exit 0; }
advance "$parent" "$closed"
