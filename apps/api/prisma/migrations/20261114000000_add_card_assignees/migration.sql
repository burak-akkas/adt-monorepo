-- CreateTable
CREATE TABLE "card_assignee" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "card_assignee_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "card_assignee_email_idx" ON "card_assignee"("email");

-- CreateIndex
CREATE UNIQUE INDEX "card_assignee_cardId_email_key" ON "card_assignee"("cardId", "email");

-- AddForeignKey
ALTER TABLE "card_assignee" ADD CONSTRAINT "card_assignee_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "card"("id") ON DELETE CASCADE ON UPDATE CASCADE;
