# Kanban

A Kanban board with accounts, built by an autonomous agent team: NestJS API, Next.js frontend, Postgres. See [CLAUDE.md](CLAUDE.md) for the layout and commands, and [docs/agent-team.md](docs/agent-team.md) for how the agent team works and how to set it up in another repository.

Live at https://adt-web-tau.vercel.app/

```
npm ci
docker compose up -d --wait db
npm run stack   # http://localhost:3000
```
