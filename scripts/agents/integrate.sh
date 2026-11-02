#!/usr/bin/env bash
# The Integrator's work on one PR from the merge queue (agent-integrator.yml runs it for each queued
# PR in turn, so only one PR is being merged at any time):
#   1. Checks the PR is still what the agents approved: the approved commit, or GitHub's clean merge
#      of the base on top of it (clean-base-update.sh). Anything else goes back to review.
#   2. If the base branch moved on, merges it in (update-branch) and records the result as approved:
#      the PR's own changes are unchanged. With AGENT_QA_ON_BASE_UPDATE, the queue waits while QA
#      tests the combined code.
#   3. Waits for the required checks on that exact commit.
#   4. With AGENT_QA_IN_QUEUE (the default when QA is on): unless QA already passed these own changes
#      (qa-passed.sh), the queue waits while QA tests exactly that commit. Nothing else merges
#      meanwhile, so QA runs once per PR, on the code that lands.
#   5. If the base moved meanwhile (a human merged something), goes back to 2. Otherwise merges
#      exactly that commit, so what lands on the base is what CI (and QA) tested.
# Conflicts and red checks go to the Implementor, timeouts and failed merges to the back of the queue.
# Red checks, timeouts and failed merges count as failed attempts: after AGENT_INTEGRATOR_MAX_ATTEMPTS
# (default 3) since the last Lead decision, the Lead decides. Conflicts don't count: they come from
# other PRs' merges, not from this one.
#
# Usage: integrate.sh <pr>
# Logs to stderr. The last stdout line is "result=<merged|bounced|requeued|left|lead>":
#   merged   merged into the base
#   bounced  sent to the Implementor (conflict or red checks)
#   requeued back of the queue (timeout, failed merge, unexpected error)
#   left     no longer in the queue (closed, draft, new commits, label removed, QA did not pass)
#   lead     handed to the Lead after too many failed attempts
# Needs GH_TOKEN, GITHUB_REPOSITORY and AGENT_BOT_ID. With AGENT_APP_ID and AGENT_APP_PRIVATE_KEY it
# renews GH_TOKEN before it expires (app-token.sh). Optional: AGENT_REQUIRED_CHECKS (default CI),
# AGENT_QA_IN_QUEUE (true: QA once, at the front of the queue), AGENT_QA_ON_BASE_UPDATE (true: QA
# after each update), AGENT_AUTO_MERGE_HIGH_RISK, AGENT_PROTECTED_PATHS
# (default .github/,scripts/,templates/), AGENT_INTEGRATOR_MAX_ATTEMPTS (3),
# AGENT_REQUIRED_CHECKS entries can be path-scoped (`Name@prefix|prefix`, see pr-paths.sh).
# AGENT_INTEGRATOR_CHECKS_MINUTES (30), AGENT_INTEGRATOR_QA_MINUTES (60), AGENT_MERGE_METHOD (squash,
# merge or rebase; default squash), AGENT_PRODUCTION_URL (the link in the issue's progress note, url.sh).
set -Eeuo pipefail

pr="$1"
repo="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY must be set}"
bot="${AGENT_BOT_ID:?AGENT_BOT_ID must be set}"
here="$(dirname "$0")"
required="${AGENT_REQUIRED_CHECKS:-CI}"   # narrowed to the checks that apply to this PR (pr-paths.sh) below
qa_on_update="${AGENT_QA_ON_BASE_UPDATE:-}"
qa_in_queue="${AGENT_QA_IN_QUEUE:-}"
qa_paths="${AGENT_QA_PATHS:-}"   # QA only for PRs that change these paths (prefix|prefix), e.g. the frontend
max_attempts="${AGENT_INTEGRATOR_MAX_ATTEMPTS:-3}"
checks_minutes="${AGENT_INTEGRATOR_CHECKS_MINUTES:-30}"
qa_minutes="${AGENT_INTEGRATOR_QA_MINUTES:-60}"
method="${AGENT_MERGE_METHOD:-squash}"
case "$method" in squash|merge|rebase) ;; *) echo "::warning::AGENT_MERGE_METHOD must be squash, merge or rebase, not '$method': squash-merging" >&2; method=squash ;; esac
run_url="${GITHUB_SERVER_URL:-https://github.com}/$repo/actions/runs/${GITHUB_RUN_ID:-}"
base=""

log()      { echo "#$pr: $*" >&2; }
# The App token expires after an hour, and one PR can take longer (slow CI, a QA hold).
refresh_token() {
  local t
  if t=$("$here/app-token.sh" 2>/dev/null) && [ -n "$t" ]; then export GH_TOKEN="$t"; fi
}
finish()   { log "result: $1"; echo "result=$1"; exit 0; }
say()      { gh pr comment "$pr" -R "$repo" --body "$1" >/dev/null; }
progress() { "$here/progress.sh" --pr "$pr" "$1"; }
pr_json()  { gh pr view "$pr" -R "$repo" --json "$1"; }
behind()   { gh api "repos/$repo/compare/$1...$base" --jq .ahead_by; }   # base commits missing from <sha>

# Failed attempts (`<!-- agent:integration-failed -->` comments) since the latest Lead decision.
failures() {
  gh api --paginate --slurp "repos/$repo/issues/$pr/comments" | jq --argjson bot "$bot" '[.[][] | select(.user.id == $bot)] as $c
    | ([$c | to_entries[] | select(.value.body | contains("<!-- agent:lead -->")) | .key] | max // -1) as $last
    | [$c | to_entries[] | select(.key > $last and (.value.body | contains("<!-- agent:integration-failed -->")))] | length'
}

# Before treating anything as a failure: the PR may have been merged after all (e.g. an API error
# right after the merge) or closed. Then it is done, not failed. Returns if the PR is still open.
settle_if_closed() {
  local s
  s=$(pr_json state | jq -r .state) || return 0
  case "$s" in
    MERGED)
      "$here/transition.sh" "$pr" agent:done >/dev/null || true
      if [ -n "${issue:-}" ]; then "$here/transition.sh" "$issue" agent:done >/dev/null || true; fi
      finish merged ;;
    CLOSED)
      "$here/transition.sh" "$pr" >/dev/null || true
      finish left ;;
  esac
}

# A failed attempt. fail bounce "<what failed>" "<instructions for the Implementor>"
#                   fail requeue "<what failed>"
fail() {
  local kind="$1" reason="$2" todo="${3:-}" used
  settle_if_closed
  used=$(( $(failures || echo 0) + 1 ))
  if [ "$used" -ge "$max_attempts" ]; then
    "$here/transition.sh" "$pr" agent:needs-decision >/dev/null
    say "<!-- agent:integration-failed -->
🛑 **Merge queue:** $reason. That's $used failed merge attempts since the last Lead decision, so #$pr leaves the queue. Lead, please decide."
    progress "🚦 **Merge queue**: #$pr failed $used merge attempts, handed to the Lead"
    finish lead
  fi
  if [ "$kind" = bounce ]; then
    "$here/transition.sh" "$pr" agent:changes-requested >/dev/null
    say "<!-- agent:merge -->
<!-- agent:integration-failed -->
❌ **Merge queue:** $reason. #$pr leaves the queue (failed attempt $used of $max_attempts). Implementor: $todo"
    progress "🚦 **Merge queue**: $reason on #$pr, back to the Implementor"
    finish bounced
  fi
  # A new admission marker puts it at the back of the queue. Re-applying agent:queued starts the
  # Integrator run that picks it up (the current run handles each PR only once).
  say "<!-- agent:queued -->
<!-- agent:integration-failed -->
⏳ **Merge queue:** $reason. #$pr goes to the back of the queue (failed attempt $used of $max_attempts)."
  "$here/transition.sh" "$pr" agent:queued >/dev/null
  progress "🚦 **Merge queue**: $reason on #$pr, back of the queue"
  finish requeued
}

# A conflict with the base: the Implementor resolves it. Not a failed attempt.
conflict() {
  "$here/transition.sh" "$pr" agent:changes-requested >/dev/null
  say "<!-- agent:merge -->
⚠️ **Merge queue:** $1, so #$pr leaves the queue. Implementor: run \`git fetch origin $base\` and \`git merge origin/$base\`, resolve the conflicts keeping the intent of both changes, run all checks, and push. Where you can, leave this PR's own edits as they were: then the re-review only has to look at the resolution."
  progress "🚦 **Merge queue**: #$pr conflicts with \`$base\`, back to the Implementor"
  finish bounced
}

# Any unexpected error: don't leave the PR stuck in agent:integrating. set -E makes command
# substitutions inherit this trap: there it only fails the substitution, so the error reaches the
# main shell, which handles it once (instead of carrying on with the handler's output as a value).
on_error() {
  if [ "$BASHPID" != "$$" ]; then exit 1; fi
  trap - ERR
  set +e
  log "unexpected error at line $1"
  fail requeue "the Integrator hit an unexpected error ([run log]($run_url))"
}
trap 'on_error $LINENO' ERR

# Records a commit as approved: the Integrator only creates commits that leave the PR's own changes
# as they were, and the merge gate and later Integrator runs only accept approved commits.
approve_commit() {   # <sha> <message>
  say "<!-- agent:integrator -->
$2

<!-- agent:approved-sha $1 -->"
}

# True while the PR is open, not a draft, at <sha> and still carries <label>: nobody else changed it.
still_ours() {   # <sha> <label>
  local v
  v=$(pr_json state,isDraft,headRefOid,labels) || return 1
  [ "$(jq -r .state <<<"$v")" = OPEN ] && [ "$(jq -r .isDraft <<<"$v")" != true ] && [ "$(jq -r .headRefOid <<<"$v")" = "$1" ] \
    && jq -e --arg l "$2" 'any(.labels[]; .name == $l)' <<<"$v" >/dev/null
}

# Drafts are how humans pause the agents: a PR that became one leaves the queue (not a failure).
# Finishes if the PR is an open draft, returns otherwise.
leave_if_draft() {
  [ "$(pr_json state,isDraft | jq -r '.state + " " + (.isDraft | tostring)')" = "OPEN true" ] || return 0
  "$here/transition.sh" "$pr" >/dev/null
  say "⏸️ **Merge queue:** #$pr is a draft now, so it leaves the queue. Mark it ready for review to send it through review and back into the queue."
  finish left
}

# GitHub computes mergeability lazily; UNKNOWN means "not yet".
mergeable() {
  local m=UNKNOWN
  for _ in 1 2 3 4 5 6; do
    m=$(pr_json mergeable | jq -r .mergeable)
    [ "$m" != UNKNOWN ] && break
    sleep 10
  done
  echo "$m"
}

# Waits for the required checks (AGENT_REQUIRED_CHECKS, workflow names) on <sha>, the same rules as QA.
# Sets CHECKS to pass, fail (FAILED lists them), timeout, missing (none of the required checks ever
# appeared: a configuration problem), or moved (the PR changed meanwhile).
wait_checks() {   # <sha>
  local sha="$1" json checks pending deadline seen=0
  local filter='[.[] | select(.workflow as $w | ($req | split(",") | map(gsub("^ +| +$"; ""))) | index($w))]'
  deadline=$(( $(date +%s) + checks_minutes * 60 ))
  CHECKS=timeout
  FAILED=
  if [ -z "$required" ]; then log "no required check applies to the paths this PR changes"; CHECKS=pass; return 0; fi
  while [ "$(date +%s)" -lt "$deadline" ]; do
    refresh_token
    if ! still_ours "$sha" agent:integrating; then CHECKS=moved; return 0; fi
    json=$(gh pr checks "$pr" -R "$repo" --json workflow,name,bucket,link 2>/dev/null || true)
    checks=$(jq --arg req "$required" "$filter" <<<"${json:-[]}")
    FAILED=$(jq -r '[.[] | select(.bucket == "fail" or .bucket == "cancel") | "[\(.name)](\(.link))"] | join(", ")' <<<"$checks")
    pending=$(jq '[.[] | select(.bucket == "pending")] | length' <<<"$checks")
    if [ "$(jq length <<<"$checks")" -gt 0 ]; then seen=1; fi
    if [ -n "$FAILED" ]; then CHECKS=fail; return 0; fi
    if [ "$(jq length <<<"$checks")" -gt 0 ] && [ "$pending" -eq 0 ]; then CHECKS=pass; return 0; fi
    sleep 30
  done
  if [ "$seen" = 0 ]; then CHECKS=missing; fi
}

# QA tests <sha> while the queue waits (AGENT_QA_IN_QUEUE, or AGENT_QA_ON_BASE_UPDATE after an update).
# QA's pass goes through the merge gate, which sees the hold marker and hands the PR back here as
# agent:integrating. Returns when that happened, finishes otherwise.
hold_for_qa() {   # <sha> <why>
  local sha="$1" deadline v labels
  say "<!-- agent:integrator-hold $sha -->
🧪 **Merge queue:** $2 QA tests \`${sha:0:7}\` now, and the queue waits for its verdict."
  "$here/transition.sh" "$pr" agent:qa >/dev/null
  progress "🚦 **Merge queue**: QA tests #$pr at the front of the queue, the queue waits"
  deadline=$(( $(date +%s) + qa_minutes * 60 ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    sleep 30
    refresh_token
    v=$(pr_json state,headRefOid,labels)
    if [ "$(jq -r .state <<<"$v")" != OPEN ] || [ "$(jq -r .headRefOid <<<"$v")" != "$sha" ]; then
      log "changed while QA was testing"; finish left
    fi
    labels=",$(jq -r '[.labels[].name] | join(",")' <<<"$v"),"
    case "$labels" in
      *",agent:integrating,"*)               # QA passed and the merge gate handed it back, unless the
        # label is left over (e.g. a failed label change): only a recorded pass counts.
        if "$here/qa-passed.sh" "$pr" "$sha" >/dev/null; then return 0; fi
        log "agent:integrating, but no QA pass for ${sha:0:7} yet" ;;
      *",agent:changes-requested,"*|*",agent:fixing,"*|*",agent:needs-decision,"*|*",agent:needs-human,"*|*",agent:review,"*)
        log "QA did not pass (labels: $labels)"; finish left ;;
    esac                                     # agent:qa, agent:approved or between labels: still going
  done
  say "⏳ **Merge queue:** QA didn't finish within $qa_minutes minutes, so the queue moves on. #$pr rejoins it when QA passes."
  finish left
}

# --- Is it still in the queue? ---
refresh_token
v=$(pr_json state,isDraft,headRefOid,baseRefName,labels,closingIssuesReferences)
state=$(jq -r .state <<<"$v")
head=$(jq -r .headRefOid <<<"$v")
base=$(jq -r .baseRefName <<<"$v")
issue=$(jq -r '.closingIssuesReferences[0].number // empty' <<<"$v")
labels=",$(jq -r '[.labels[].name] | join(",")' <<<"$v"),"

if [ "$state" = MERGED ]; then
  "$here/transition.sh" "$pr" agent:done >/dev/null
  finish left
fi
[ "$state" = OPEN ] || finish left
case "$labels" in *",agent:queued,"*|*",agent:integrating,"*) ;; *) log "no longer queued"; finish left ;; esac
leave_if_draft

"$here/transition.sh" "$pr" agent:integrating >/dev/null
log "integrating ${head:0:7} into $base"

# --- 1. Still exactly what was approved? ---
approved=$("$here/approved-sha.sh" "$pr")
if [ "$head" != "$approved" ]; then
  if [ -n "$approved" ] && "$here/clean-base-update.sh" "$pr" "$head" >/dev/null; then
    approve_commit "$head" "🔄 **Merge queue:** \`${head:0:7}\` is GitHub's clean merge of \`$base\` into the approved \`${approved:0:7}\`, so #$pr's own changes are as approved."
  else
    "$here/transition.sh" "$pr" agent:review >/dev/null
    say "🔁 **Merge queue:** $([ -n "$approved" ] && echo "the agents approved \`${approved:0:7}\`, but the head is now \`${head:0:7}\`" || echo "no recorded approval for \`${head:0:7}\`"). Sending it through review again."
    progress "🚦 **Merge queue**: head of #$pr moved after approval, back to review"
    finish left
  fi
fi

# --- Still allowed to merge without a human? The merge gate checked this at approval, but the
# issue's risk can be raised since (a human adds risk:high). The protected paths are re-checked too.
if [ -n "$issue" ] && [ "${AGENT_AUTO_MERGE_HIGH_RISK:-}" != true ] \
   && gh api "repos/$repo/issues/$issue/labels" --jq '.[].name' | grep -qx 'risk:high'; then
  "$here/transition.sh" "$pr" agent:needs-human >/dev/null
  say "✋ **Merge queue:** #$issue is now **high risk**, so a human merges #$pr. It leaves the queue."
  progress "🚦 **Merge queue**: #$pr is high risk now, a human merges it"
  finish left
fi
protected="${AGENT_PROTECTED_PATHS:-.github/,scripts/,templates/}"
touched=$(gh pr diff "$pr" -R "$repo" --name-only | grep -E "^(${protected//,/|})" || true)
if [ -n "$touched" ]; then
  "$here/transition.sh" "$pr" agent:needs-human >/dev/null
  say "✋ **Merge queue:** #$pr changes the agent team's own tooling, so a human merges it:
$(printf '%s\n' "$touched" | sed 's/^/- `/; s/$/`/')"
  finish left
fi

# The required checks that apply to the files this PR changes (all of them, unless some are path-scoped).
required=$("$here/pr-paths.sh" required "$pr" | paste -sd, -)
qa_applies=true
if [ "$qa_in_queue" = true ] && [ -n "$qa_paths" ]; then
  if "$here/pr-paths.sh" touches "$pr" "$qa_paths"; then :; else
    rc=$?; [ "$rc" = 1 ] || fail requeue "couldn't read the files #$pr changes"
    qa_applies=false; log "changes nothing under AGENT_QA_PATHS ($qa_paths): no QA"
  fi
fi

# --- 2.-4. Update, test, merge. Repeats only if the base moves outside the queue. ---
for _ in 1 2 3; do
  if ! still_ours "$head" agent:integrating; then leave_if_draft; log "the PR changed or left the queue"; finish left; fi
  if [ "$(mergeable)" = CONFLICTING ]; then
    conflict "#$pr conflicts with \`$base\`"
  fi
  n_behind=$(behind "$head")
  updated=""
  if [ "$n_behind" -gt 0 ]; then
    log "behind $base by $n_behind, updating"
    if ! err=$(gh api -X PUT "repos/$repo/pulls/$pr/update-branch" -f expected_head_sha="$head" 2>&1 >/dev/null); then
      if [ "$(mergeable)" = CONFLICTING ]; then conflict "#$pr conflicts with \`$base\`"; fi
      # Refused without a conflict: usually because \`$base\` changed workflow files, which the App
      # may not push (no Workflows permission, by design). The Implementor can't push them either,
      # so a human merges the base in. One retry first, in case it was a passing error.
      sleep 10
      if ! err=$(gh api -X PUT "repos/$repo/pulls/$pr/update-branch" -f expected_head_sha="$head" 2>&1 >/dev/null); then
        "$here/transition.sh" "$pr" agent:needs-human >/dev/null
        say "✋ **Merge queue:** GitHub refused to merge \`$base\` into #$pr although they don't conflict, most likely because \`$base\` changed workflow files, which the agents' App may not push. A human: merge \`$base\` into this branch (\`git merge origin/$base\`, push), then apply \`agent:approved\`.
> $(printf '%s' "$err" | tail -1)"
        progress "🚦 **Merge queue**: \`$base\` can't be merged into #$pr by the agents (workflow files?), a human must"
        finish left
      fi
    fi
    new="$head"
    for _ in $(seq 1 30); do
      sleep 4
      new=$(pr_json headRefOid | jq -r .headRefOid)
      [ "$new" != "$head" ] && break
    done
    [ "$new" != "$head" ] || fail requeue "updating the branch didn't produce a new commit in time"
    if ! "$here/clean-base-update.sh" "$pr" "$new" >/dev/null; then
      # Not our merge commit: someone pushed at the same moment.
      "$here/transition.sh" "$pr" agent:review >/dev/null
      say "🔁 **Merge queue:** #$pr got new commits while it was being updated. Sending it through review again."
      finish left
    fi
    approve_commit "$new" "🔄 **Merge queue:** merged \`$base\` ($n_behind new commit(s)) into #$pr. Its own changes are unchanged, so it isn't reviewed again. $([ "$qa_on_update" = true ] && echo "QA and CI test" || echo "CI tests") the combined code before it merges.$([ "$qa_in_queue" = true ] && echo " QA tests it then, unless it already passed these changes.")"
    head="$new"
    updated=" (the combined code with the latest \`$base\`)"
    progress "🚦 **Merge queue**: brought #$pr up to date with \`$base\`, testing the combined code"
    if [ "$qa_on_update" = true ]; then hold_for_qa "$head" "This is the combined code with the latest \`$base\` (\`AGENT_QA_ON_BASE_UPDATE\`)."; fi
  fi

  wait_checks "$head"
  case "$CHECKS" in
    moved)   leave_if_draft; log "the PR changed while its checks ran"; finish left ;;
    fail)    fail bounce "required checks failed on \`${head:0:7}\`$updated: $FAILED" \
               "open the failing check and reproduce it locally. If it only fails together with the latest \`$base\`, run \`git fetch origin $base\` and \`git merge origin/$base\` first. Fix it, run all checks, and push." ;;
    timeout) fail requeue "the required checks ($required) didn't finish within $checks_minutes minutes" ;;
    missing)
      # No agent can fix this, and retrying every PR would only burn reviews and Lead decisions.
      "$here/transition.sh" "$pr" agent:needs-human >/dev/null
      say "🛑 **Merge queue:** none of the required checks (\`AGENT_REQUIRED_CHECKS\` = \`$required\`) reported on \`${head:0:7}\` within $checks_minutes minutes. Check that variable against the workflow names in the PR's checks, then apply \`agent:approved\` again."
      progress "🚦 **Merge queue**: no required check reported on #$pr, a human must check \`AGENT_REQUIRED_CHECKS\`"
      finish left ;;
  esac

  # Merge only if nothing landed on the base since the checks started: then the tested code is
  # exactly what lands. Inside the queue nothing else merges; this catches merges by humans.
  # QA once, here: the checks passed, so this commit can merge, and nothing else merges while QA tests
  # it. A PR whose own changes QA already passed (e.g. a human merged into the base during QA, and the
  # loop updated it again) isn't tested again: CI covers the new combination.
  if [ "$qa_in_queue" = true ] && [ "$qa_applies" = true ] && ! "$here/qa-passed.sh" "$pr" "$head" >/dev/null; then
    hold_for_qa "$head" "The required checks passed on #$pr$updated, so it can merge."
  fi
  # Right before the merge (nothing slow in between: a human can still merge by hand meanwhile).
  if [ "$(behind "$head")" -gt 0 ]; then log "$base moved while the checks (or QA) ran, updating again"; continue; fi
  refresh_token
  # gh can report an error after the merge itself succeeded (e.g. deleting the branch failed), so
  # the PR's state decides, not the exit code.
  err=$(gh pr merge "$pr" -R "$repo" "--$method" --delete-branch --match-head-commit "$head" 2>&1) || true
  if [ "$(pr_json state | jq -r .state)" = MERGED ]; then
    "$here/transition.sh" "$pr" agent:done >/dev/null
    if [ -n "$issue" ]; then
      "$here/transition.sh" "$issue" agent:done >/dev/null
      prod=$("$here/url.sh" production)
      "$here/progress.sh" "$issue" "✅ **Merged** #$pr$([ -n "$prod" ] && echo ", deploying to [production]($prod)" || true)"
    fi
    "$here/sweep-conflicts.sh" "$pr" "$base" >&2
    "$here/release-waiting.sh" >&2   # issues that waited for this PR's files can start now
    finish merged
  fi
  log "merge failed: $err"
  # New commits (merge refused by --match-head-commit) or a closed PR: not a failed attempt. The push
  # takes the PR out of the queue and through review (pr-still-current.sh).
  if ! still_ours "$head" agent:integrating; then leave_if_draft; log "the PR changed while merging"; finish left; fi
  if [ "$(behind "$head")" -gt 0 ]; then continue; fi
  fail requeue "the merge failed: $(printf '%s' "$err" | tail -1)"
done
fail requeue "\`$base\` kept moving while #$pr was being tested"
