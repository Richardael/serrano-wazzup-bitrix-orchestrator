import { z } from "zod";

export const WazzupWebhookSchema = z.object({
  test: z.boolean().optional(),
  eventId: z.string().optional(),
  messageId: z.string().optional(),
  channelId: z.string().optional(),
  direction: z.enum(["inbound", "outbound"]).optional(),
  messageType: z.enum(["text", "image", "video", "audio", "document", "other"]).optional(),
  occurredAt: z.string().optional(),
  contact: z
    .object({
      id: z.string().optional(),
      name: z.string().optional(),
      phone: z.string().optional(),
    })
    .optional(),
  content: z
    .object({
      text: z.string().optional(),
      attachments: z.array(z.unknown()).optional(),
    })
    .optional(),
});

export type WazzupWebhookPayload = z.infer<typeof WazzupWebhookSchema>;
