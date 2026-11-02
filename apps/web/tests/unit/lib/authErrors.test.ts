import { describe, expect, it } from "vitest";
import {
  EMAIL_TAKEN_ERROR,
  GENERIC_ERROR,
  INVALID_EMAIL_ERROR,
  INVALID_LOGIN_ERROR,
  WEAK_PASSWORD_ERROR,
  authErrorMessage,
  validateAuthForm,
} from "@/lib/authErrors";

describe("validateAuthForm", () => {
  it("accepts a valid registration", () => {
    expect(validateAuthForm("register", { email: "a@example.test", password: "test-password-123" })).toBeNull();
  });

  it("rejects a weak password on register", () => {
    expect(validateAuthForm("register", { email: "a@example.test", password: "short" })).toBe(WEAK_PASSWORD_ERROR);
    expect(WEAK_PASSWORD_ERROR).toContain("10");
  });

  it("rejects a bad email on register", () => {
    expect(validateAuthForm("register", { email: "nope", password: "test-password-123" })).toBe(INVALID_EMAIL_ERROR);
  });

  it("uses the single credentials message for an invalid login form", () => {
    expect(validateAuthForm("login", { email: "", password: "" })).toBe(INVALID_LOGIN_ERROR);
  });
});

describe("authErrorMessage", () => {
  it("maps a taken email on register", () => {
    expect(authErrorMessage("register", { status: 422, code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL" })).toBe(
      EMAIL_TAKEN_ERROR,
    );
  });

  it("maps a weak password on register", () => {
    expect(authErrorMessage("register", { status: 400, code: "PASSWORD_TOO_SHORT" })).toBe(WEAK_PASSWORD_ERROR);
  });

  it("gives every login credentials failure the same message", () => {
    const a = authErrorMessage("login", { status: 401, code: "INVALID_EMAIL_OR_PASSWORD" });
    const b = authErrorMessage("login", { status: 401, code: "USER_NOT_FOUND" });
    const c = authErrorMessage("login", { status: 400, code: "INVALID_PASSWORD" });
    expect(a).toBe(INVALID_LOGIN_ERROR);
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it("falls back to a generic message for server errors", () => {
    expect(authErrorMessage("login", { status: 500 })).toBe(GENERIC_ERROR);
    expect(authErrorMessage("register", { status: 500, code: "X" })).toBe(GENERIC_ERROR);
    expect(authErrorMessage("register", null)).toBe(GENERIC_ERROR);
  });
});
