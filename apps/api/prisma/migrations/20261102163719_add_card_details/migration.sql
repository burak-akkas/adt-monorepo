-- CreateTable
CREATE TABLE "checklist_item" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "checklist_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "card_comment" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" TIMESTAMP(3),

    CONSTRAINT "card_comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "card_label" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "card_label_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "card_activity" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "from" TEXT,
    "to" TEXT,

    CONSTRAINT "card_activity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "checklist_item_cardId_position_idx" ON "checklist_item"("cardId", "position");

-- CreateIndex
CREATE INDEX "card_comment_cardId_createdAt_idx" ON "card_comment"("cardId", "createdAt");

-- CreateIndex
CREATE INDEX "card_label_cardId_position_idx" ON "card_label"("cardId", "position");

-- CreateIndex
CREATE INDEX "card_activity_cardId_at_idx" ON "card_activity"("cardId", "at");

-- Case-insensitive unique label per card (Prisma can't express this).
CREATE UNIQUE INDEX "card_label_cardId_lower_name_key" ON "card_label" ("cardId", lower("name"));

-- AddForeignKey
ALTER TABLE "checklist_item" ADD CONSTRAINT "checklist_item_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "card"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card_comment" ADD CONSTRAINT "card_comment_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "card"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card_label" ADD CONSTRAINT "card_label_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "card"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card_activity" ADD CONSTRAINT "card_activity_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "card"("id") ON DELETE CASCADE ON UPDATE CASCADE;
