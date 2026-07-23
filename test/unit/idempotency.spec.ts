import { describe, it, expect } from "vitest";
import { createHash } from "crypto";

function computeIdempotencyKey(
  providerEventId: string | null,
  channelId: string | null,
  normalizedPhone: string,
  direction: string,
  occurredAt: string,
): string {
  if (providerEventId) {
    return `evt:${providerEventId}`;
  }

  const raw = [channelId ?? "", normalizedPhone, direction, occurredAt].join("|");
  return `hash:${createHash("sha256").update(raw).digest("hex").slice(0, 32)}`;
}

describe("idempotency key", () => {
  it("uses providerEventId when available", () => {
    const key = computeIdempotencyKey("evt_001", "ch1", "+584141234567", "inbound", "2026-01-01");
    expect(key).toBe("evt:evt_001");
  });

  it("falls back to deterministic hash without providerEventId", () => {
    const key1 = computeIdempotencyKey(null, "ch1", "+584141234567", "inbound", "2026-01-01");
    const key2 = computeIdempotencyKey(null, "ch1", "+584141234567", "inbound", "2026-01-01");
    const key3 = computeIdempotencyKey(null, "ch1", "+584141234567", "outbound", "2026-01-01");
    expect(key1).toBe(key2);
    expect(key1).not.toBe(key3);
  });

  it("produces different hashes for different phones", () => {
    const key1 = computeIdempotencyKey(null, "ch1", "+584141234567", "inbound", "2026-01-01");
    const key2 = computeIdempotencyKey(null, "ch1", "+584141112345", "inbound", "2026-01-01");
    expect(key1).not.toBe(key2);
  });
});
