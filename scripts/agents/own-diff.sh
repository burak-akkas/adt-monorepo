#!/usr/bin/env bash
# Prints a PR's own changes as of a commit: for each changed file (sorted by name), its status and
# the added and removed lines in order, without hunk positions or context lines.
#
# Two commits with the same output make exactly the same edits. Whatever else differs between them
# came from the base branch, e.g. when a merge of the base needed a conflict resolution that kept
# both sides. The edits themselves are what review approved.
#
# Usage: own-diff.sh <base-ref> <sha>
# Diffs <base-ref>...<sha>, i.e. from their merge base, like the PR diff on GitHub.
# Exits 2 when GitHub's diff is incomplete (300+ files, or a file without a patch: binary or too
# large). The result can't be compared then.
# Needs GH_TOKEN and GITHUB_REPOSITORY.
set -euo pipefail

base="$1"
sha="$2"
repo="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY must be set}"

json=$(gh api "repos/$repo/compare/$base...$sha")
printf '%s' "$json" | jq -e '(.files | length) < 300
  and all(.files[]; .patch != null or (.status == "renamed" and .changes == 0))' >/dev/null || exit 2

printf '%s' "$json" | jq -r '.files | sort_by(.filename)[]
  | "=== \(.filename) (\(.status)\(if .previous_filename then " from \(.previous_filename)" else "" end))",
    ((.patch // "") | split("\n")[] | select(test("^[-+]")))'
