-- CreateTable
CREATE TABLE "board_member" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "board_member_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "board_member_email_idx" ON "board_member"("email");

-- CreateIndex
CREATE UNIQUE INDEX "board_member_boardId_email_key" ON "board_member"("boardId", "email");

-- AddForeignKey
ALTER TABLE "board_member" ADD CONSTRAINT "board_member_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "board"("id") ON DELETE CASCADE ON UPDATE CASCADE;
