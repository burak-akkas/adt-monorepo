import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";

// Local, CI and QA databases only: the deploy workflow never runs this. Test accounts go here.
const connectionString = process.env.DATABASE_URL ?? "postgresql://kanban:kanban@localhost:5432/kanban";
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

await prisma.appSetting.upsert({
  where: { key: "seeded" },
  update: { value: "true" },
  create: { key: "seeded", value: "true" },
});
await prisma.$disconnect();
