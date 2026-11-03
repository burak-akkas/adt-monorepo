import { z } from "zod";

// Same pipeline as `emailSchema` in index.ts (which can't be imported here: it would be circular).
export const memberEmailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

export const inviteMemberRequestSchema = z.object({ email: memberEmailSchema });

export const memberSchema = z.object({ id: z.string(), email: z.string() });

export const boardMembersResponseSchema = z.object({
  owner: z.object({ email: z.string() }),
  members: z.array(memberSchema),
});

export type InviteMemberRequest = z.infer<typeof inviteMemberRequestSchema>;
export type Member = z.infer<typeof memberSchema>;
export type BoardMembersResponse = z.infer<typeof boardMembersResponseSchema>;
