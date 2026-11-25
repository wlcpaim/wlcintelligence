import { describe, expect, it } from "vitest";
import {
  extractOtpDigits,
  generateSecurePassword,
  isValidEmail,
  normalizeEmail,
} from "./auth-email";

describe("auth-email helpers", () => {
  it("normalizes and validates emails cleanly", () => {
    expect(normalizeEmail("  User@Example.COM  ")).toBe("user@example.com");
    expect(isValidEmail("dev@wlcia.app")).toBe(true);
    expect(isValidEmail("  Dev+1@sub.domain.com ")).toBe(true);
    expect(isValidEmail("")).toBe(false);
    expect(isValidEmail("not-an-email")).toBe(false);
    expect(isValidEmail("user@domain")).toBe(false);
    expect(isValidEmail("user@domain.c")).toBe(false);
  });

  it("extracts up to 6 numeric OTP digits", () => {
    expect(extractOtpDigits("123-456")).toBe("123456");
    expect(extractOtpDigits("ab987654321")).toBe("987654");
    expect(extractOtpDigits("   ")).toBe("");
  });

  it("generates strong unique passwords with all character classes", () => {
    const first = generateSecurePassword();
    const second = generateSecurePassword();

    expect(first.length).toBe(14);
    expect(first).not.toBe(second);
    expect(/[A-Z]/.test(first)).toBe(true);
    expect(/[a-z]/.test(first)).toBe(true);
    expect(/[0-9]/.test(first)).toBe(true);
    expect(/[!@#$%&*]/.test(first)).toBe(true);
  });
});