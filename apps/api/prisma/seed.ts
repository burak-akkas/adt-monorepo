import { PrismaPg } from "@prisma/adapter-pg";
import { createAuth } from "../src/auth/auth.js";
import { PrismaClient } from "../src/generated/prisma/client.js";

// Local, CI and QA databases only: the deploy workflow never runs this. Test accounts go here.
const connectionString = process.env.DATABASE_URL ?? "postgresql://kanban:kanban@localhost:5432/kanban";
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const auth = createAuth(prisma);

await prisma.appSetting.upsert({
  where: { key: "seeded" },
  update: { value: "true" },
  create: { key: "seeded", value: "true" },
});

// The seed runs in a single process, so the check-then-create below has no race to handle.
// The library hashes the password. An existing account is left alone, so running the seed twice changes nothing.
for (const email of ["a@example.test", "b@example.test"]) {
  if (await prisma.user.findUnique({ where: { email } })) continue;
  await auth.api.signUpEmail({ body: { name: email.split("@")[0], email, password: "test-password-123" } });
}
await prisma.$disconnect();
