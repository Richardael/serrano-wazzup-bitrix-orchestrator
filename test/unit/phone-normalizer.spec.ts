import { describe, it, expect } from "vitest";
import { normalizePhoneNumber, maskPhoneForLog, phoneLookupVariants } from "../../src/infrastructure/config/phone-normalizer";

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

describe("phoneLookupVariants", () => {
  it("covers the ways a Venezuelan number is stored in Bitrix", () => {
    expect(phoneLookupVariants("+584122187719")).toEqual([
      "584122187719", // +58...
      "04122187719", // 0412... y +0412...
      "5804122187719", // +580412... (un 0 de más)
      "4122187719", // sin prefijo
    ]);
  });

  it("returns only the digits for a non-Venezuelan number", () => {
    expect(phoneLookupVariants("+37125893011")).toEqual(["37125893011"]);
  });

  it("returns nothing for an empty value", () => {
    expect(phoneLookupVariants("")).toEqual([]);
  });
});
