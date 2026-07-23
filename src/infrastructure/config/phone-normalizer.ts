import { parsePhoneNumberFromString, CountryCode } from "libphonenumber-js";

export function normalizePhoneNumber(raw: string, defaultCountry: CountryCode = "VE"): string | null {
  const cleaned = raw.replace(/[\s\-().]/g, "");

  const parsed = parsePhoneNumberFromString(cleaned, defaultCountry);

  if (!parsed || !parsed.isValid()) {
    return null;
  }

  return parsed.format("E.164");
}

export function maskPhoneForLog(phone: string): string {
  if (phone.length <= 8) {
    return "***";
  }
  return phone.slice(0, 4) + "****" + phone.slice(-4);
}

export function extractPhoneCountry(normalizedPhone: string): string | null {
  const parsed = parsePhoneNumberFromString(normalizedPhone);
  return parsed?.country ?? null;
}
