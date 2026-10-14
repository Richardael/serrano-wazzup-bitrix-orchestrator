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

/**
 * Formas en las que el mismo teléfono puede estar guardado en un lead de Bitrix.
 *
 * Bitrix compara solo los dígitos, y quien captura el lead (el equipo de
 * Instagram, una ejecutiva en tienda) lo escribe como le llega: "04122187719",
 * "+04122187719" o "+5804122187719" (con un 0 de más). Buscar solo "+584122187719"
 * no encuentra esos leads y el orquestador creaba uno duplicado. Para un móvil o
 * fijo venezolano se devuelven las variantes habituales; para cualquier otro país
 * solo el número tal cual, porque ahí no se puede suponer nada.
 */
export function phoneLookupVariants(normalizedPhone: string): string[] {
  const digits = normalizedPhone.replace(/\D/g, "");
  const ve = /^58(\d{10})$/.exec(digits);
  if (!ve) return digits ? [digits] : [];
  const national = ve[1]!;
  return [`58${national}`, `0${national}`, `580${national}`, national];
}
