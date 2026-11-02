import { PASSWORD_MIN_LENGTH, loginFormSchema, registerFormSchema } from "@adt/contracts";

export type AuthMode = "login" | "register";

export const GENERIC_ERROR = "Something went wrong. Please try again.";
export const INVALID_LOGIN_ERROR = "Invalid email or password.";
export const EMAIL_TAKEN_ERROR = "An account with this email already exists.";
export const WEAK_PASSWORD_ERROR = `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
export const INVALID_EMAIL_ERROR = "Enter a valid email address.";

export type AuthFormValues = { email: string; password: string };
export type AuthApiError = { status?: number; code?: string; message?: string } | null | undefined;

export function validateAuthForm(mode: AuthMode, values: AuthFormValues): string | null {
  const result = (mode === "register" ? registerFormSchema : loginFormSchema).safeParse(values);
  if (result.success) return null;
  const fields = new Set(result.error.issues.map((issue) => issue.path[0]));
  if (mode === "login") return INVALID_LOGIN_ERROR;
  if (fields.has("email")) return INVALID_EMAIL_ERROR;
  return WEAK_PASSWORD_ERROR;
}

export function authErrorMessage(mode: AuthMode, error: AuthApiError): string {
  if (!error) return GENERIC_ERROR;
  if (mode === "login") {
    // Same message for every credentials failure: never reveal whether the email exists.
    const status = error.status ?? 0;
    return status >= 400 && status < 500 ? INVALID_LOGIN_ERROR : GENERIC_ERROR;
  }
  const code = error.code ?? "";
  if (code.startsWith("USER_ALREADY_EXISTS")) return EMAIL_TAKEN_ERROR;
  if (code === "PASSWORD_TOO_SHORT" || code === "PASSWORD_TOO_LONG") return WEAK_PASSWORD_ERROR;
  if (code === "INVALID_EMAIL") return INVALID_EMAIL_ERROR;
  return GENERIC_ERROR;
}
