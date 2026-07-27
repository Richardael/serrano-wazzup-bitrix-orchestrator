import { Controller, Post, Body, HttpCode, Logger } from "@nestjs/common";
import { IncomingMessageHandler } from "../../application/services/incoming-message.handler";
import { InternalController } from "../http/internal.controller";

@Controller("wazzup-ingest")
export class WazzupIngestController {
  private readonly logger = new Logger(WazzupIngestController.name);

  constructor(private readonly handler: IncomingMessageHandler) {}

  @Post()
  @HttpCode(200)
  async ingest(@Body() body: unknown): Promise<{ status: string }> {
    try {
      if (!body || typeof body !== "object") {
        return { status: "ok" };
      }

      const b = body as Record<string, unknown>;

      const isPing = b["type"] === "ping" || b["event"] === "ping" || Object.keys(b).length === 0;
      if (isPing) {
        this.logger.log("Wazzup verification ping received");
        return { status: "ok" };
      }

      const sanitized = this.sanitizePayload(b);
      InternalController.lastPayload = {
        receivedAt: new Date().toISOString(),
        keys: Object.keys(b),
        preview: JSON.stringify(b).slice(0, 2000),
        full: sanitized,
      };

      this.logger.log(`RAW WAZZUP PAYLOAD keys: ${Object.keys(b).join(", ")}`);
      this.logger.log(`RAW WAZZUP PAYLOAD: ${JSON.stringify(b).slice(0, 2000)}`);

      const messages = b["messages"] as Array<Record<string, unknown>> | undefined;
      let finalStatus = "no_messages";

      if (messages && messages.length > 0) {
        this.logger.log(`Processing ${messages.length} messages from array`);
        for (const msg of messages) {
          this.logger.log(`Message keys: ${Object.keys(msg).join(", ")}`);
          this.logger.log(`Message: ${JSON.stringify(msg).slice(0, 500)}`);
          const mappedPayload = this.mapToWebhookPayload(msg);
          if (mappedPayload) {
            this.logger.log(`Mapped payload: ${JSON.stringify(mappedPayload).slice(0, 500)}`);
            const result = await this.handler.handle(mappedPayload);
            this.logger.log(`Handler result: ${JSON.stringify(result)}`);
            finalStatus = result.status;
          } else {
            this.logger.warn("Could not map message to webhook payload — missing phone");
            finalStatus = "no_phone";
          }
        }
      } else {
        const mapped = this.mapToWebhookPayload(b);
        if (mapped) {
          this.logger.log(`Single event mapped: ${JSON.stringify(mapped).slice(0, 500)}`);
          const result = await this.handler.handle(mapped);
          this.logger.log(`Handler result: ${JSON.stringify(result)}`);
          finalStatus = result.status;
        } else {
          this.logger.warn(`Could not map event to webhook payload — keys: ${Object.keys(b).join(", ")}`);
          finalStatus = "no_phone";
        }
      }

      return { status: finalStatus };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`INGEST ERROR: ${msg}`);
      return { status: "error" };
    }
  }

  private mapToWebhookPayload(msg: Record<string, unknown>): Record<string, unknown> | null {
    const phone = msg["phone"] ?? msg["sender"] ?? msg["chatId"] ?? msg["contactPhone"] ?? msg["clientPhone"]
      ?? msg["chat_id"] ?? msg["contact_phone"] ?? msg["from"];

    if (!phone) {
      this.logger.warn(`Message without phone. Available keys: ${Object.keys(msg).join(", ")}`);
      return null;
    }

    this.logger.log(`Extracted phone: ${String(phone)}`);

    const chatId = String(msg["chatId"] ?? msg["chat_id"] ?? msg["id"] ?? "");
    const channelId = String(msg["channelId"] ?? msg["channel_id"] ?? "");

    return {
      eventId: String(msg["id"] ?? msg["messageId"] ?? msg["message_id"] ?? ""),
      messageId: String(msg["id"] ?? msg["messageId"] ?? msg["message_id"] ?? ""),
      channelId,
      chatId,
      direction: msg["direction"] === "outbound" || msg["type"] === "outgoing" ? "outbound" : "inbound",
      messageType: msg["contentType"] === "image" || msg["content_type"] === "image" ? "image"
        : msg["contentType"] === "video" || msg["content_type"] === "video" ? "video" : "text",
      occurredAt: String(msg["timestamp"] ?? msg["createdAt"] ?? msg["created_at"] ?? new Date().toISOString()),
      contact: {
        id: msg["contactId"] ?? msg["contact_id"] ?? null,
        name: msg["contactName"] ?? msg["senderName"] ?? msg["sender_name"] ?? null,
        phone: String(phone),
      },
      content: {
        text: msg["text"] ?? msg["body"] ?? null,
        attachments: msg["attachments"] ?? msg["media"] ?? [],
      },
    };
  }

  private sanitizePayload(obj: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (key === "text" || key === "body" || key === "message") {
        result[key] = "[REDACTED]";
      } else if (Array.isArray(value)) {
        result[key] = value.map((item) =>
          typeof item === "object" && item !== null
            ? this.sanitizePayload(item as Record<string, unknown>)
            : item,
        );
      } else if (typeof value === "object" && value !== null) {
        result[key] = this.sanitizePayload(value as Record<string, unknown>);
      } else {
        result[key] = value;
      }
    }
    return result;
  }
}
