#!/usr/bin/env bash
# Path rules for repositories with several parts (a monorepo with a backend and a frontend, say),
# decided from the files a PR changes.
#
#   pr-paths.sh required <pr>
#     Prints the required checks (workflow names, one per line) that apply to the PR, from
#     AGENT_REQUIRED_CHECKS (default CI): comma-separated entries, each `Name` (always required) or
#     `Name@prefix|prefix…` (required only when the PR changes a file under one of the prefixes), e.g.
#       Backend CI@backend/|shared/, Frontend CI@web/|shared/, Lint
#     So a workflow that only runs for some paths (on.pull_request.paths) is only waited for when it runs.
#     Prints nothing when none applies (e.g. a docs-only PR with only path-scoped checks).
#   pr-paths.sh touches <pr> <prefix|prefix…>
#     Exits 0 if the PR changes a file under one of the prefixes (or the list is empty), 1 otherwise.
# Any error (e.g. the API) exits 3, so callers never mistake it for "doesn't change those paths".
#
# Prefixes are plain path prefixes (`web/`, `packages/ui/`, `README.md`), no globs.
# Needs GH_TOKEN and GITHUB_REPOSITORY.
set -Eeuo pipefail
trap 'exit 3' ERR

cmd="${1:?usage: pr-paths.sh required <pr> | touches <pr> <prefixes>}"
pr="${2:?usage: pr-paths.sh required <pr> | touches <pr> <prefixes>}"
repo="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY must be set}"

loaded=false
files=""
load() {   # the PR's changed files, read once (the REST listing covers up to 3000 files)
  if [ "$loaded" = false ]; then
    files=$(gh api --paginate "repos/$repo/pulls/$pr/files?per_page=100" --jq '.[].filename')
    loaded=true
  fi
}
under() {   # <prefix|prefix…>: does the PR change a file under one of them?
  local p f
  [ -n "${1// /}" ] || return 0
  load
  IFS='|' read -ra prefixes <<<"$1"
  for p in "${prefixes[@]}"; do
    p="$(echo "$p" | sed 's/^ *//; s/ *$//')"
    [ -n "$p" ] || continue
    while IFS= read -r f; do
      if [[ -n "$f" && "$f" == "$p"* ]]; then return 0; fi
    done <<<"$files"
  done
  return 1
}

# Read the files here, outside any condition: a failed read must fail the script (inside `if` or `&&`
# set -e is off), never look like "no files changed" and drop a required check.
case "$cmd" in
  required) [[ "${AGENT_REQUIRED_CHECKS:-CI}" != *@* ]] || load ;;
  touches)  [ -z "${3// /}" ] || load ;;
esac
[ "$loaded" = false ] || [ -n "$files" ] || { echo "pr-paths.sh: PR #$pr lists no changed files" >&2; exit 3; }

case "$cmd" in
  required)
    IFS=',' read -ra entries <<<"${AGENT_REQUIRED_CHECKS:-CI}"
    for e in "${entries[@]}"; do
      e="$(echo "$e" | sed 's/^ *//; s/ *$//')"
      [ -n "$e" ] || continue
      if [[ "$e" == *@* ]]; then
        if under "${e#*@}"; then echo "${e%%@*}" | sed 's/ *$//'; fi
      else
        echo "$e"
      fi
    done
    ;;
  touches)
    if under "${3:-}"; then exit 0; else exit 1; fi ;;
  *) echo "pr-paths.sh: unknown command '$cmd'" >&2; exit 2 ;;
esac
