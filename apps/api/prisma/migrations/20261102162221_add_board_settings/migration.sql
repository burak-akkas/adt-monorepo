-- CreateEnum
CREATE TYPE "BoardView" AS ENUM ('board', 'calendar', 'table');

-- AlterTable
ALTER TABLE "board" ADD COLUMN     "backgroundColor" TEXT,
ADD COLUMN     "backgroundImageUrl" TEXT,
ADD COLUMN     "doingListId" TEXT,
ADD COLUMN     "doneListId" TEXT,
ADD COLUMN     "view" "BoardView" NOT NULL DEFAULT 'board';

-- AlterTable
ALTER TABLE "board_list" ADD COLUMN     "collapsed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "wipLimit" INTEGER;

-- CreateTable
CREATE TABLE "board_former_list" (
    "boardId" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "board_former_list_pkey" PRIMARY KEY ("boardId","listId")
);

-- AddForeignKey
ALTER TABLE "board" ADD CONSTRAINT "board_doingListId_fkey" FOREIGN KEY ("doingListId") REFERENCES "board_list"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board" ADD CONSTRAINT "board_doneListId_fkey" FOREIGN KEY ("doneListId") REFERENCES "board_list"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_former_list" ADD CONSTRAINT "board_former_list_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "board"("id") ON DELETE CASCADE ON UPDATE CASCADE;
