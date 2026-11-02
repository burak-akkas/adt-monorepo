-- AlterTable
ALTER TABLE "card" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "boardId" TEXT,
ALTER COLUMN "listId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "card_boardId_archivedAt_idx" ON "card"("boardId", "archivedAt");

-- AddForeignKey
ALTER TABLE "card" ADD CONSTRAINT "card_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "board"("id") ON DELETE CASCADE ON UPDATE CASCADE;
