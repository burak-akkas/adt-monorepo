-- AlterTable
ALTER TABLE "board" ADD COLUMN     "importKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "board_userId_importKey_key" ON "board"("userId", "importKey");
