-- CreateTable
CREATE TABLE "card_template" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "priority" "Priority" NOT NULL DEFAULT 'medium',
    "notes" TEXT,
    "labels" TEXT[],
    "cover" "CoverColor",
    "checklist" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "card_template_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "card_template_boardId_createdAt_idx" ON "card_template"("boardId", "createdAt");

-- Case-insensitive unique name per board (Prisma can't express this).
CREATE UNIQUE INDEX "card_template_boardId_lower_name_key" ON "card_template" ("boardId", lower("name"));

-- AddForeignKey
ALTER TABLE "card_template" ADD CONSTRAINT "card_template_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "board"("id") ON DELETE CASCADE ON UPDATE CASCADE;
