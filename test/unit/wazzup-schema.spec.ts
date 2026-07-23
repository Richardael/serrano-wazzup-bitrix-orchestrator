import { describe, it, expect } from "vitest";
import { WazzupWebhookSchema } from "../../src/interfaces/webhooks/wazzup-webhook.schema";

describe("WazzupWebhookSchema", () => {
  it("accepts test payload", () => {
    const result = WazzupWebhookSchema.safeParse({ test: true });
    expect(result.success).toBe(true);
  });

  it("accepts valid message payload", () => {
    const payload = {
      eventId: "evt_001",
      messageId: "msg_001",
      channelId: "ch_001",
      direction: "inbound",
      messageType: "text",
      occurredAt: "2026-07-22T12:00:00Z",
      contact: {
        id: "ext_001",
        name: "Juan Perez",
        phone: "+584141234567",
      },
      content: {
        text: "Hola",
        attachments: [],
      },
    };
    const result = WazzupWebhookSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it("accepts minimal payload with just phone", () => {
    const result = WazzupWebhookSchema.safeParse({
      contact: { phone: "04141234567" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects non-object payload", () => {
    const result = WazzupWebhookSchema.safeParse("not an object");
    expect(result.success).toBe(false);
  });

  it("rejects invalid direction", () => {
    const result = WazzupWebhookSchema.safeParse({
      direction: "sideways",
      contact: { phone: "+584141234567" },
    });
    expect(result.success).toBe(false);
  });
});
