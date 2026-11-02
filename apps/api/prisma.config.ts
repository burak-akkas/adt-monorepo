import { defineConfig } from "prisma/config";

// Migrations use the direct connection in production. Without any URL set: the local database in docker-compose.yml.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? "postgresql://kanban:kanban@localhost:5432/kanban" },
});
