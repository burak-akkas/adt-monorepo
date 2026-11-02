#!/usr/bin/env bash
# Prints the commit a branch points to on origin, or nothing if the branch doesn't exist there.
# Usage: branch-head.sh <branch>
set -uo pipefail

git ls-remote --heads origin "refs/heads/$1" 2>/dev/null | cut -f1 | head -1
exit 0
