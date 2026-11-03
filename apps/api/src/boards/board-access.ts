import type { Prisma } from "../generated/prisma/client.js";

/** Boards the user owns or has been invited to. `email` is matched lower-cased. Emails are not verified. */
export function boardAccessWhere(userId: string, email: string): Prisma.BoardWhereInput {
  return { OR: [{ userId }, { members: { some: { email: email.toLowerCase() } } }] };
}

/** Boards the user owns. */
export function boardOwnerWhere(userId: string): Prisma.BoardWhereInput {
  return { userId };
}
