import { describe, it, expect } from "vitest";
import { normalizePhoneNumber, maskPhoneForLog } from "../../src/infrastructure/config/phone-normalizer";

describe("normalizePhoneNumber", () => {
  it("normalizes Venezuela mobile number", () => {
    expect(normalizePhoneNumber("0414-1234567")).toBe("+584141234567");
  });

  it("normalizes with +58 prefix", () => {
    expect(normalizePhoneNumber("+58 414 1234567")).toBe("+584141234567");
  });

  it("normalizes without leading +", () => {
    expect(normalizePhoneNumber("584141234567")).toBe("+584141234567");
  });

  it("normalizes Venezuela landline", () => {
    expect(normalizePhoneNumber("0212-1234567")).toBe("+582121234567");
  });

  it("preserves already normalized number", () => {
    expect(normalizePhoneNumber("+584141234567")).toBe("+584141234567");
  });

  it("preserves international number", () => {
    expect(normalizePhoneNumber("+1 212 555 0199")).toBe("+12125550199");
  });

  it("returns null for invalid characters", () => {
    expect(normalizePhoneNumber("abc123")).toBeNull();
  });

  it("returns null for incomplete number", () => {
    expect(normalizePhoneNumber("0414")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(normalizePhoneNumber("")).toBeNull();
  });
});

describe("maskPhoneForLog", () => {
  it("masks middle digits", () => {
    expect(maskPhoneForLog("+584141234567")).toBe("+584****4567");
  });

  it("masks short numbers", () => {
    expect(maskPhoneForLog("12345")).toBe("***");
  });
});
