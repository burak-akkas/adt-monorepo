import { MAX_ACTIVITY_ENTRIES, type ActivityType } from "@adt/contracts";
import type { Prisma } from "../generated/prisma/client.js";

export interface ActivityEntryInput {
  type: ActivityType;
  from?: string | null;
  to?: string | null;
  at?: Date;
}

/**
 * Writes one activity entry through the caller's transaction client, then drops the entries
 * beyond the newest MAX_ACTIVITY_ENTRIES for the card (same order as the read path).
 */
export async function recordActivity(tx: Prisma.TransactionClient, cardId: string, entry: ActivityEntryInput): Promise<void> {
  await tx.cardActivity.create({
    data: {
      cardId,
      type: entry.type,
      at: entry.at ?? new Date(),
      from: entry.from ? entry.from : null,
      to: entry.to ? entry.to : null,
    },
  });
  const excess = await tx.cardActivity.findMany({
    where: { cardId },
    orderBy: [{ at: "desc" }, { id: "desc" }],
    skip: MAX_ACTIVITY_ENTRIES,
    select: { id: true },
  });
  if (excess.length > 0) {
    await tx.cardActivity.deleteMany({ where: { id: { in: excess.map((row) => row.id) } } });
  }
}
