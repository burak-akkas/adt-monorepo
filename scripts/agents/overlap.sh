#!/usr/bin/env bash
# Conflict avoidance: which in-flight work touches the files an issue's design plans to change?
# Two agent PRs that edit the same files conflict as soon as one merges, and each conflict costs an
# Implementor run, a re-review and another trip through the merge queue. Waiting for the other work to
# merge first, then starting from code that contains it, is cheaper.
#
# In-flight work is:
#   - open agent PRs (branch agent/*), with the files they actually change, except drafts and PRs
#     waiting for a human (they may wait for days; nobody should wait for them)
#   - issues the Implementor is about to start or working on (agent:ready, agent:in-progress), with the
#     files their design plans to change
# Planned files come from the Architect (the `<!-- agent:files [...] -->` marker the Architect workflow
# records). An issue without that marker overlaps nothing.
# AGENT_CONFLICT_IGNORE: files that don't count, as |-separated glob patterns (default: lockfiles and
# changelogs, which every PR touches and that merge without trouble or get regenerated).
#
# Usage: overlap.sh <issue>
# Prints one line per overlapping item: "#<n> <file> <file>…", nothing if none.
# Needs GH_TOKEN, GITHUB_REPOSITORY and AGENT_BOT_ID.
set -euo pipefail

issue="$1"
repo="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY must be set}"
bot="${AGENT_BOT_ID:?AGENT_BOT_ID must be set}"
ignore="${AGENT_CONFLICT_IGNORE:-*package-lock.json|*pnpm-lock.yaml|*yarn.lock|*Cargo.lock|*poetry.lock|*uv.lock|*go.sum|*CHANGELOG.md}"

planned() {   # <issue>: the files its latest design plans to change, one per line
  gh api --paginate --slurp "repos/$repo/issues/$1/comments" \
    | jq -r --argjson bot "$bot" '[.[][] | select(.user.id == $bot) | .body
        | capture("<!-- agent:files (?<f>\\[.*?\\]) -->").f] | last // "[]" | fromjson | .[]'
}
counts() {   # <file>: does it count for conflicts?
  local p
  IFS='|' read -ra pats <<<"$ignore"
  for p in "${pats[@]}"; do
    # shellcheck disable=SC2053   # the pattern is meant to glob
    [[ -n "$p" && "$1" == $p ]] && return 1
  done
  return 0
}

mine=$(planned "$issue" | while IFS= read -r f; do if counts "$f"; then echo "$f"; fi; done | sort -u)
[ -n "$mine" ] || exit 0

gh api --paginate --slurp "repos/$repo/issues?state=open&per_page=100" \
  | jq -r '.[][] | [.number, (if .pull_request then "pr" else "issue" end), ((.draft // false) | tostring),
                    ([.labels[].name] | join(","))] | @tsv' \
  | while IFS=$'\t' read -r n kind draft labels; do
      [ "$n" = "$issue" ] && continue
      case ",$labels," in *",agent:needs-human,"*) continue ;; esac
      if [ "$kind" = pr ]; then
        [ "$draft" = true ] && continue
        ref=$(gh api "repos/$repo/pulls/$n" --jq .head.ref)
        [[ "$ref" == agent/* && "$ref" != "agent/issue-$issue" ]] || continue
        theirs=$(gh api --paginate "repos/$repo/pulls/$n/files?per_page=100" --jq '.[].filename')
      else
        case ",$labels," in *",agent:ready,"*|*",agent:in-progress,"*) ;; *) continue ;; esac
        theirs=$(planned "$n")
      fi
      both=$(comm -12 <(printf '%s\n' "$mine") <(printf '%s\n' "$theirs" | sort -u) | tr '\n' ' ')
      if [ -n "${both// /}" ]; then echo "#$n ${both% }"; fi
    done
