#!/usr/bin/env bash
# Prints a GitHub App installation token that stays valid for at least another 15 minutes.
# Installation tokens expire after an hour, and an Integrator run can take longer (a long queue,
# slow CI, a QA hold). Long-running steps call this before using gh: it reuses the cached token
# while it is younger than 45 minutes, and mints a new one from the App's private key otherwise.
# The new token is limited to this repository, like the one the workflow starts with.
#
# Usage: GH_TOKEN=$(app-token.sh)
#   The workflow seeds the cache with its starting token: printf '%s %s\n' "$(date +%s)" "$GH_TOKEN" > "$AGENT_TOKEN_CACHE"
# Needs AGENT_APP_ID, AGENT_APP_PRIVATE_KEY and GITHUB_REPOSITORY. Without the App id or key it
# prints GH_TOKEN unchanged (e.g. in the simulator). Cache: AGENT_TOKEN_CACHE (default
# $RUNNER_TEMP/agent-app-token), one line "<minted-at epoch> <token>".
set -euo pipefail

if [ -z "${AGENT_APP_ID:-}" ] || [ -z "${AGENT_APP_PRIVATE_KEY:-}" ]; then
  printf '%s' "${GH_TOKEN:-}"
  exit 0
fi
repo="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY must be set}"
cache="${AGENT_TOKEN_CACHE:-${RUNNER_TEMP:-/tmp}/agent-app-token}"
now=$(date +%s)

if [ -s "$cache" ]; then
  read -r minted token < "$cache"
  if [ -n "${token:-}" ] && [ $(( now - minted )) -lt 2700 ]; then
    printf '%s' "$token"
    exit 0
  fi
fi

b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
key=$(mktemp)
trap 'rm -f "$key"' EXIT
printf '%s\n' "$AGENT_APP_PRIVATE_KEY" > "$key"
header=$(printf '{"alg":"RS256","typ":"JWT"}' | b64url)
payload=$(printf '{"iat":%d,"exp":%d,"iss":"%s"}' $(( now - 60 )) $(( now + 540 )) "$AGENT_APP_ID" | b64url)
signature=$(printf '%s.%s' "$header" "$payload" | openssl dgst -sha256 -sign "$key" | b64url)
jwt="$header.$payload.$signature"

api="${GITHUB_API_URL:-https://api.github.com}"
installation=$(curl -fsS -H "Authorization: Bearer $jwt" -H "Accept: application/vnd.github+json" \
  "$api/repos/$repo/installation" | jq -r .id)
token=$(curl -fsS -X POST -H "Authorization: Bearer $jwt" -H "Accept: application/vnd.github+json" \
  -d "{\"repositories\":[\"${repo#*/}\"]}" "$api/app/installations/$installation/access_tokens" | jq -r '.token // empty')
[ -n "$token" ] || { echo "app-token.sh: GitHub returned no token" >&2; exit 1; }

umask 077
printf '%s %s\n' "$now" "$token" > "$cache"
printf '%s' "$token"
