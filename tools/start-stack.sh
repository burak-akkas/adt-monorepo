#!/usr/bin/env bash
# Builds and starts the whole stack from the current checkout, against its own database on the local
# Postgres (docker compose up -d --wait db). CI, QA and QA's baseline each use their own ports and database.
#
# Usage: tools/start-stack.sh <web-port> <api-port> <database-name>
set -euo pipefail

web_port="${1:?usage: start-stack.sh <web-port> <api-port> <database-name>}"
api_port="${2:?usage: start-stack.sh <web-port> <api-port> <database-name>}"
database="${3:?usage: start-stack.sh <web-port> <api-port> <database-name>}"

export DATABASE_URL="postgresql://kanban:kanban@localhost:5432/$database"
export API_URL="http://localhost:$api_port"
export COMMIT_SHA="$(git rev-parse --verify -q HEAD || echo dev)"

npm run db:migrate:deploy -w apps/api
npm run db:seed -w apps/api
npm run build -w apps/api
npm run build -w apps/web

PORT="$api_port" npm run start -w apps/api &
npm run start -w apps/web -- -p "$web_port" &
wait
