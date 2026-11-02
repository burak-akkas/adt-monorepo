#!/usr/bin/env bash
# Prints the project's preview or production URL, from the templates in the repository variables:
#   AGENT_PREVIEW_URL     default https://{owner}.github.io/{repo}/pr-{pr}/  (a PR's live preview)
#   AGENT_PRODUCTION_URL  default https://{owner}.github.io/{repo}/          (the deployed default branch)
# {owner}, {repo} and {pr} are filled in. A template set to `none` prints nothing (the project has no
# such site), so callers leave the link out.
#
# Usage: url.sh preview <pr> | url.sh production
# Needs GITHUB_REPOSITORY.
set -euo pipefail

kind="${1:?usage: url.sh preview <pr> | url.sh production}"
pr="${2:-}"
repo="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY must be set}"

case "$kind" in
  preview)    template="${AGENT_PREVIEW_URL:-}"; default='https://{owner}.github.io/{repo}/pr-{pr}/' ;;
  production) template="${AGENT_PRODUCTION_URL:-}"; default='https://{owner}.github.io/{repo}/' ;;
  *) echo "url.sh: unknown kind '$kind'" >&2; exit 2 ;;
esac
[ -n "$template" ] || template="$default"
# none: no such site; deployment: the preview URL is only known from the deployment (QA finds it).
case "$template" in none|deployment) exit 0 ;; esac
template="${template//\{owner\}/${repo%%/*}}"
template="${template//\{repo\}/${repo#*/}}"
echo "${template//\{pr\}/$pr}"
