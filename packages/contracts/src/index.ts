import { z } from "zod";

export * from "./boards.js";
export * from "./cards.js";
export * from "./lists.js";

// The API's request and response shapes. Both apps import them from here, so they can't drift apart.
export const healthResponseSchema = z.object({
  status: z.enum(["ok", "error"]),
  commit: z.string(),
  database: z.enum(["ok", "error"]),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

// Accounts. The auth endpoints themselves belong to Better Auth, mounted at /auth in the API.
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));
export const passwordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);

export const registerFormSchema = z.object({ email: emailSchema, password: passwordSchema });
export const loginFormSchema = z.object({ email: emailSchema, password: z.string().min(1).max(PASSWORD_MAX_LENGTH) });

export const changePasswordFormSchema = z.object({
  currentPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  newPassword: passwordSchema,
});
export const deleteAccountFormSchema = z.object({ password: z.string().min(1).max(PASSWORD_MAX_LENGTH) });

export const authUserSchema = z.object({ id: z.string(), email: z.string() });
export const sessionResponseSchema = z.object({ user: authUserSchema }).nullable();

export type RegisterForm = z.infer<typeof registerFormSchema>;
export type LoginForm = z.infer<typeof loginFormSchema>;
export type ChangePasswordForm = z.infer<typeof changePasswordFormSchema>;
export type DeleteAccountForm = z.infer<typeof deleteAccountFormSchema>;
export type AuthUser = z.infer<typeof authUserSchema>;
export type SessionResponse = z.infer<typeof sessionResponseSchema>;
