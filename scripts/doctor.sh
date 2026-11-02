#!/usr/bin/env bash
# Checks that a repository is wired up for the agent team before the first issue: the toolkit files on
# the default branch, the App's variables and secrets, the labels, the required checks, and that the
# QA, merge and link settings fit together. Changes nothing.
#
# Usage: scripts/doctor.sh <owner/repo>
# Needs gh (logged in with access to the repository's settings: variables, secrets) and jq.
# Prints one line per check (✅ ok, ⚠️ worth a look, ❌ must be fixed) and exits 1 if anything must be fixed.
# Variables can be set on the repository or its organization; both are read.
set -uo pipefail

repo="${1:?usage: doctor.sh <owner/repo>}"
here="$(dirname "$0")"
errors=0; warnings=0
ok()   { echo "✅ $*"; }
warn() { echo "⚠️  $*"; warnings=$((warnings + 1)); }
bad()  { echo "❌ $*"; errors=$((errors + 1)); }

info=$(gh api "repos/$repo" 2>/dev/null) || { echo "❌ can't read $repo with gh (logged in? access?)"; exit 1; }
branch=$(jq -r .default_branch <<<"$info")
private=$(jq -r .private <<<"$info")
ok "$repo, default branch \`$branch\`$([ "$private" = true ] && echo ", private")"

# --- variables and secrets ---------------------------------------------------------------------
# Reading them needs admin-level access; without it, say so instead of reporting them missing.
can_vars=true; can_secrets=true
vars=$(gh api --paginate "repos/$repo/actions/variables" --jq '.variables[] | "\(.name)=\(.value)"' 2>/dev/null) || can_vars=false
vars+=$'\n'$(gh api --paginate "repos/$repo/actions/organization-variables" --jq '.variables[] | "\(.name)=\(.value)"' 2>/dev/null || true)
var() { printf '%s\n' "$vars" | grep -m1 "^$1=" | cut -d= -f2- ; }
secrets=$(gh api --paginate "repos/$repo/actions/secrets" --jq '.secrets[].name' 2>/dev/null) || can_secrets=false
secrets+=$'\n'$(gh api --paginate "repos/$repo/actions/organization-secrets" --jq '.secrets[].name' 2>/dev/null || true)

if [ "$can_vars" = false ]; then
  warn "can't read the repository's variables with this gh login (needs admin access): the checks below assume the defaults"
fi
for v in AGENT_APP_ID AGENT_BOT_ID; do
  if [ -n "$(var "$v")" ]; then ok "variable $v is set"
  elif [ "$can_vars" = true ]; then bad "variable $v is missing"; fi
done
bot_id=$(var AGENT_BOT_ID)
if [ -n "$bot_id" ]; then
  login=$(gh api "user/$bot_id" --jq .login 2>/dev/null || true)
  case "$login" in
    *"[bot]") ok "AGENT_BOT_ID $bot_id is $login" ;;
    "") bad "AGENT_BOT_ID $bot_id is no GitHub user (it's the App's bot user id: gh api users/<app-slug>[bot] --jq .id)" ;;
    *) bad "AGENT_BOT_ID $bot_id is $login, not a bot account" ;;
  esac
fi
for s in AGENT_APP_PRIVATE_KEY CLAUDE_CODE_OAUTH_TOKEN; do
  if printf '%s\n' "$secrets" | grep -qx "$s"; then ok "secret $s is set"
  elif [ "$can_secrets" = false ]; then warn "can't list secrets (needs admin access): check $s yourself"
  else bad "secret $s is missing"; fi
done

# --- toolkit files on the default branch ---------------------------------------------------------
missing=()
for f in .github/agents/implementor.md .github/agents/reviewer.md .github/agents/lead.md \
         .github/workflows/agent-implementor.yml .github/workflows/agent-reviewer.yml .github/workflows/agent-lead.yml \
         .github/workflows/agent-merge.yml .github/workflows/agent-integrator.yml .github/workflows/agent-watchdog.yml \
         scripts/agents/transition.sh scripts/agents/integrate.sh CLAUDE.md; do
  gh api "repos/$repo/contents/$f?ref=$branch" --silent 2>/dev/null || missing+=("$f")
done
if [ ${#missing[@]} -eq 0 ]; then ok "toolkit files are on \`$branch\`"
else bad "missing on \`$branch\` (scripts/install.sh copies them): ${missing[*]}"; fi
gh api "repos/$repo/contents/.github/ISSUE_TEMPLATE/agent-task.yml?ref=$branch" --silent 2>/dev/null \
  || warn "no issue form on \`$branch\` (scripts/install.sh copies it): issues still work, without the form"

# --- labels ---------------------------------------------------------------------------------------
have=$(gh api --paginate "repos/$repo/labels?per_page=100" --jq '.[].name' 2>/dev/null)
need=$(grep -oE '^label "[^"]+"' "$here/setup-labels.sh" | cut -d'"' -f2)
absent=$(comm -23 <(sort <<<"$need") <(sort <<<"$have") | tr '\n' ' ')
if [ -z "${absent// /}" ]; then ok "all agent labels exist"; else bad "labels missing (run scripts/setup-labels.sh $repo): $absent"; fi

# --- required checks ---------------------------------------------------------------------------------
workflows=$(gh api --paginate "repos/$repo/actions/workflows" --jq '.workflows[].name' 2>/dev/null) || workflows=""
required=$(var AGENT_REQUIRED_CHECKS); required="${required:-CI}"
IFS=',' read -ra checks <<<"$required"
[ -n "$workflows" ] || { warn "can't list the workflows: check AGENT_REQUIRED_CHECKS ($required) against the workflow names yourself"; checks=(); }
for c in "${checks[@]}"; do
  scope=""; [[ "$c" == *@* ]] && scope=" (when a PR changes ${c#*@})"
  c="$(echo "${c%%@*}" | sed 's/^ *//; s/ *$//')"
  if printf '%s\n' "$workflows" | grep -qxF -- "$c"; then ok "required check \`$c\` is a workflow$scope"
  else bad "required check \`$c\` (AGENT_REQUIRED_CHECKS) matches no workflow name, so the merge queue would never see it pass. Workflows: $(printf '%s' "$workflows" | tr '\n' ',' )"; fi
done

# --- settings that must fit together ----------------------------------------------------------------
method=$(var AGENT_MERGE_METHOD); method="${method:-squash}"
case "$method" in
  squash|merge|rebase)
    allowed=$(jq -r --arg m "$method" '{squash: .allow_squash_merge, merge: .allow_merge_commit, rebase: .allow_rebase_merge}[$m]' <<<"$info")
    if [ "$allowed" = false ]; then bad "AGENT_MERGE_METHOD=$method, but the repository doesn't allow $method merges"
    else ok "merge method: $method"; fi ;;
  *) bad "AGENT_MERGE_METHOD must be squash, merge or rebase, not '$method'" ;;
esac

stage=$(var AGENT_QA_STAGE)
case "$stage" in ""|queue|review) ;; *) bad "AGENT_QA_STAGE must be queue or review, not '$stage'" ;; esac

if [ "$can_vars" = false ]; then
  warn "skipped the QA, merge and pause settings checks (variables unreadable)"
elif [ "$(var AGENT_QA)" = true ]; then
  preview=$(var AGENT_PREVIEW_URL)
  if [ -n "$(var AGENT_QA_PATHS)" ]; then ok "QA only for PRs that change $(var AGENT_QA_PATHS) (AGENT_QA_PATHS)"; fi
  if [ "$preview" = deployment ]; then
    ok "QA tests the URL of each PR's successful GitHub deployment$( [ -n "$(var AGENT_PREVIEW_ENVIRONMENT)" ] && echo " in $(var AGENT_PREVIEW_ENVIRONMENT)"); the App needs Deployments: Read"
    recent=$(gh api "repos/$repo/deployments?per_page=5" --jq 'length' 2>/dev/null || echo 0)
    [ "$recent" -gt 0 ] || warn "no GitHub deployments in $repo yet: does your host report preview deployments to GitHub?"
  elif [ "$preview" = none ]; then
    if [ -n "$(var AGENT_QA_START_COMMAND)" ]; then ok "QA starts the app itself (AGENT_PREVIEW_URL=none)"
    else bad "AGENT_PREVIEW_URL=none needs AGENT_QA_START_COMMAND, or QA can't test anything"; fi
  else
    prod=$(GITHUB_REPOSITORY="$repo" AGENT_PRODUCTION_URL="$(var AGENT_PRODUCTION_URL)" "$here/agents/url.sh" production)
    ok "QA tests previews at $(GITHUB_REPOSITORY="$repo" AGENT_PREVIEW_URL="$preview" "$here/agents/url.sh" preview N); a deploy must serve version.txt with the PR's head sha"
    if [ -n "$prod" ] && ! curl -fsSL -o /dev/null "${prod}version.txt" 2>/dev/null; then
      warn "the production site ${prod}version.txt doesn't answer: QA's visual baseline needs it (or set AGENT_BASELINE_URL=none)"
    fi
  fi
  baseline=$(var AGENT_BASELINE_URL)
  if [ -n "$(var AGENT_BASELINE_START_COMMAND)" ]; then
    ok "QA starts its baseline on the runner (AGENT_BASELINE_START_COMMAND); it needs its own port and database"
  elif { [ "$preview" = none ] || [ "$preview" = deployment ]; } && [ "$baseline" != none ] && [ -n "$baseline$(var AGENT_PRODUCTION_URL)" ]; then
    warn "QA's visual baseline is ${baseline:-$(var AGENT_PRODUCTION_URL)}. If the app stores data on a server, QA can't set up test data there: use AGENT_BASELINE_START_COMMAND (or AGENT_BASELINE_URL=none)"
  fi
  if [ "$(var AGENT_E2E_COMMAND)" = none ]; then warn "no e2e suite (AGENT_E2E_COMMAND=none): QA only tests by hand in the browser"; fi
  shots=$(var AGENT_QA_SCREENSHOTS)
  if [ "$private" = true ] && [ "$shots" = pages ]; then
    warn "private repository with AGENT_QA_SCREENSHOTS=pages: raw gh-pages image links don't render there (artifact is the default for private repositories)"
  fi
  if [ "$shots" != artifact ] && { [ "$private" != true ] || [ "$shots" = pages ]; }; then
    gh api "repos/$repo/branches/gh-pages" --silent 2>/dev/null && ok "gh-pages branch exists (QA screenshots)" \
      || warn "no gh-pages branch: QA screenshots need it (or set AGENT_QA_SCREENSHOTS=artifact)"
  fi
  if [ "$(var AGENT_NODE_VERSION)" = none ]; then ok "AGENT_NODE_VERSION=none: QA's browser tools use the runner's preinstalled Node"; fi
else
  ok "QA is off (AGENT_QA): PRs merge after review and CI"
fi

# Every required check scoped to paths: a PR that changes nothing under them (a root file, say) has no checks.
if [ "${#checks[@]}" -gt 0 ] && ! printf '%s\n' "${checks[@]}" | grep -qv '@'; then
  warn "every required check in AGENT_REQUIRED_CHECKS is scoped to paths: a PR outside them merges without any check. Add one that always runs"
fi

prod_check=$(var AGENT_PRODUCTION_CHECK_URL)
if [ -n "$prod_check" ]; then
  if curl -fsSL -o /dev/null --max-time 20 "$prod_check" 2>/dev/null; then ok "production check: $prod_check answers; it must contain the deployed commit's sha"
  else warn "AGENT_PRODUCTION_CHECK_URL ($prod_check) doesn't answer: every merge will open an issue until it does"; fi
fi

# A risk policy decides what needs a human, so a PR must not be able to relax it on its own.
if gh api "repos/$repo/contents/CLAUDE.md?ref=$branch" -H "Accept: application/vnd.github.raw" 2>/dev/null | grep -q '^## Risk policy'; then
  case ",$(var AGENT_PROTECTED_PATHS)," in
    *,CLAUDE.md,*) ok "CLAUDE.md has a risk policy, and AGENT_PROTECTED_PATHS protects it" ;;
    *) warn "CLAUDE.md has a risk policy, but an agent PR could change it and merge by itself: add CLAUDE.md to AGENT_PROTECTED_PATHS (keep the defaults: .github/,scripts/,templates/,CLAUDE.md)" ;;
  esac
fi

if [ "$can_vars" = true ] && [ "$(var AGENT_AUTO_MERGE)" != true ]; then warn "AGENT_AUTO_MERGE isn't true: approved PRs wait for a human to merge them"; fi
if [ "$(var AGENT_PAUSED)" = true ]; then warn "AGENT_PAUSED is true: every agent job is stopped"; fi

perm=$(gh api "repos/$repo/actions/permissions" --jq .enabled 2>/dev/null || true)
if [ "$perm" = false ]; then bad "GitHub Actions is disabled for the repository"; fi

echo
echo "$errors to fix, $warnings to look at."
[ "$errors" -eq 0 ]
