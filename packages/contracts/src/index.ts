import { z } from "zod";

// The API's request and response shapes. Both apps import them from here, so they can't drift apart.
export const healthResponseSchema = z.object({
  status: z.enum(["ok", "error"]),
  commit: z.string(),
  database: z.enum(["ok", "error"]),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
