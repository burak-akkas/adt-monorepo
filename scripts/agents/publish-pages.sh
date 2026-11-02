#!/usr/bin/env bash
# Publishes a directory into the gh-pages branch, retrying when another workflow
# pushed in the meantime (production deploys, PR previews and QA screenshots all
# write to gh-pages, often at the same moment).
#
# Usage: publish-pages.sh <source-dir> <dest-path> <commit-message> [--replace]
#   dest-path   "." for the site root, or e.g. "pr-12", "qa/pr-12/<run>"
#   --replace   delete files in dest-path that are not in source-dir (previews).
#               Never used for the root, so previews and QA screenshots are kept.
# Needs GH_TOKEN (contents: write) and GITHUB_REPOSITORY.
set -euo pipefail

src="$1"
dest="$2"
message="$3"
replace="${4:-}"
repo="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY must be set}"
work="$(mktemp -d)"

git clone -q --depth 1 --branch gh-pages "https://x-access-token:${GH_TOKEN:?GH_TOKEN must be set}@github.com/$repo.git" "$work"
git -C "$work" config user.name "github-actions[bot]"
git -C "$work" config user.email "41898283+github-actions[bot]@users.noreply.github.com"

mkdir -p "$work/$dest"
if [ "$replace" = "--replace" ] && [ "$dest" != "." ]; then
  rsync -a --delete "$src/" "$work/$dest/"
else
  rsync -a "$src/" "$work/$dest/"
fi
touch "$work/.nojekyll"

git -C "$work" add -A
if git -C "$work" diff --cached --quiet; then
  echo "Nothing to publish"
  exit 0
fi
git -C "$work" commit -qm "$message"

for attempt in 1 2 3 4 5; do
  if git -C "$work" push -q origin gh-pages; then
    echo "Published $dest (attempt $attempt)"
    exit 0
  fi
  echo "Push rejected (attempt $attempt), rebasing on the latest gh-pages"
  sleep $((attempt * 3))
  git -C "$work" fetch -q --depth 20 origin gh-pages
  git -C "$work" rebase -q origin/gh-pages
done
echo "::error::Could not publish to gh-pages after 5 attempts"
exit 1
