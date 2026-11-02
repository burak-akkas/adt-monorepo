-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('low', 'medium', 'high');

-- CreateEnum
CREATE TYPE "CoverColor" AS ENUM ('red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink');

-- CreateTable
CREATE TABLE "board" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "board_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "board_list" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "board_list_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "card" (
    "id" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "priority" "Priority" NOT NULL DEFAULT 'medium',
    "cover" "CoverColor",
    "dueDate" DATE,
    "notes" TEXT,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "card_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "board_userId_idx" ON "board"("userId");

-- CreateIndex
CREATE INDEX "board_list_boardId_position_idx" ON "board_list"("boardId", "position");

-- CreateIndex
CREATE INDEX "card_listId_position_idx" ON "card"("listId", "position");

-- AddForeignKey
ALTER TABLE "board" ADD CONSTRAINT "board_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_list" ADD CONSTRAINT "board_list_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "board"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card" ADD CONSTRAINT "card_listId_fkey" FOREIGN KEY ("listId") REFERENCES "board_list"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Case-insensitive unique names. Prisma can't express these, so they only live here.
CREATE UNIQUE INDEX "board_userId_lower_name_key" ON "board"("userId", lower("name"));

CREATE UNIQUE INDEX "board_list_boardId_lower_name_key" ON "board_list"("boardId", lower("name"));
