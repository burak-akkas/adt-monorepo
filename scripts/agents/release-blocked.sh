#!/usr/bin/env bash
# Restarts issues the Implementor parked because they depend on other open issues.
# The Implementor workflow records those as a bot `<!-- agent:waits-on 54,60 -->` comment and
# labels the issue `agent:blocked`. For each such issue (the newest marker counts):
#   - every listed issue closed as completed -> back to `agent:ready` (the design stands)
#   - any listed issue closed as not planned -> the Lead decides (`agent:needs-decision`)
#   - otherwise it keeps waiting
# Sub-issues blocked by their siblings carry no waits-on marker; subissues.sh handles those.
#
# Usage: release-blocked.sh
# Needs GH_TOKEN, GITHUB_REPOSITORY and AGENT_BOT_ID.
set -euo pipefail

repo="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY must be set}"
bot="${AGENT_BOT_ID:?AGENT_BOT_ID must be set}"
here="$(dirname "$0")"

for n in $(gh issue list -R "$repo" --state open --label agent:blocked --limit 100 --json number --jq '.[].number'); do
  deps=$(gh api --paginate --slurp "repos/$repo/issues/$n/comments" | jq -r --argjson bot "$bot" \
    '[.[][] | select(.user.id == $bot) | (.body // "") | capture("<!-- agent:waits-on (?<d>[0-9,]+) -->").d] | last // ""' | tr ',' ' ')
  [ -z "$deps" ] && continue

  open=""; dropped=""
  for d in $deps; do
    case "$(gh api "repos/$repo/issues/$d" --jq '"\(.state) \(.state_reason // "")"')" in
      "closed completed")   ;;
      "closed not_planned") dropped="$dropped #$d" ;;
      *)                    open="$open #$d" ;;
    esac
  done

  if [ -n "$dropped" ]; then
    "$here/transition.sh" "$n" agent:needs-decision >/dev/null
    gh issue comment "$n" -R "$repo" --body "⚠️ This issue waited for$dropped, which was closed as **not planned**. Lead: decide whether it can go ahead without it." >/dev/null
    "$here/progress.sh" "$n" "🧩 **Dependency dropped**:$dropped closed as not planned, handed to the Lead"
    echo "#$n: dependency$dropped dropped, handed to the Lead"
  elif [ -z "$open" ]; then
    "$here/transition.sh" "$n" agent:ready >/dev/null
    "$here/progress.sh" "$n" "🧩 **Unblocked**: $(echo "$deps" | sed -E 's/([0-9]+)/#\1/g') done, implementing"
    echo "#$n: dependencies done, back to the Implementor"
  else
    echo "#$n still waits for$open"
  fi
done
