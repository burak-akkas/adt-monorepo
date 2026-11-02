#!/usr/bin/env bash
# After a merge: does production serve the merged commit? Polls AGENT_PRODUCTION_CHECK_URL until its body
# contains the commit's sha (a health endpoint or version.txt that reports the deployed commit), for up to
# AGENT_PRODUCTION_CHECK_MINUTES (default 15).
#
#   ok, and an earlier failure's issue is open: says so there and closes it
#   not ok, and the base branch has moved on: nothing to report, the newer merge's check takes over
#   not ok: opens one issue for a human (or adds to the one already open) and exits 1
#
# Failures go to a human, not the agents: a broken production usually needs someone with access to it.
#
# Usage: production-check.sh <merged-sha> <base-branch>
# Needs GH_TOKEN, GITHUB_REPOSITORY and AGENT_PRODUCTION_CHECK_URL.
set -euo pipefail

sha="${1:?usage: production-check.sh <merged-sha> <base-branch>}"
base="${2:?usage: production-check.sh <merged-sha> <base-branch>}"
repo="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY must be set}"
url="${AGENT_PRODUCTION_CHECK_URL:?AGENT_PRODUCTION_CHECK_URL must be set}"
minutes="${AGENT_PRODUCTION_CHECK_MINUTES:-15}"
here="$(dirname "$0")"
marker="<!-- agent:production-check -->"
run="${GITHUB_SERVER_URL:-https://github.com}/$repo/actions/runs/${GITHUB_RUN_ID:-}"

# The open issue of an earlier failure, if any.
open_issue() {
  gh api --paginate "repos/$repo/issues?state=open&per_page=100" \
    --jq "[.[] | select((.body // \"\") | contains(\"$marker\")) | .number] | .[]" | head -n 1
}

case "$url" in *\?*) sep='&' ;; *) sep='?' ;; esac
body=""
for _ in $(seq 1 $((minutes * 2))); do
  body=$(curl -fsSL --max-time 20 "${url}${sep}t=$(date +%s)" 2>/dev/null || true)
  case "$body" in
    *"$sha"*)
      echo "Production serves $sha"
      issue=$(open_issue)
      if [ -n "$issue" ]; then
        gh issue comment "$issue" -R "$repo" --body "✅ Production serves \`${sha:0:7}\` again. Closing."
        gh issue close "$issue" -R "$repo"
      fi
      exit 0 ;;
  esac
  sleep 30
done

head=$(gh api "repos/$repo/branches/$base" --jq .commit.sha)
if [ "$head" != "$sha" ]; then
  echo "Production never served $sha, but \`$base\` is at $head by now: the newer merge's check takes over"
  exit 0
fi

summary="Production didn't serve \`${sha:0:7}\` at $url within $minutes minutes ([run]($run)). Last response: \`$(printf '%s' "${body:-nothing}" | head -c 200 | tr -d '\`\r\n')\`"
issue=$(open_issue)
if [ -n "$issue" ]; then
  gh issue comment "$issue" -R "$repo" --body "⚠️ Still failing. $summary"
else
  file=$(mktemp)
  printf '%s\n⚠️ %s\n\nThe deploy may have failed, or the app may be down. Check the deploy workflow and the host. This issue closes itself when production serves a merged commit again.\n' "$marker" "$summary" > "$file"
  created=$(gh issue create -R "$repo" --title "Production check failed for ${sha:0:7}" --body-file "$file")
  "$here/transition.sh" "${created##*/}" agent:needs-human
fi
echo "::error::Production didn't serve $sha at $url within $minutes minutes"
exit 1
