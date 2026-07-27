import { Controller, Post, Body, HttpCode, Logger } from "@nestjs/common";
import { IncomingMessageHandler } from "../../application/services/incoming-message.handler";

@Controller("wazzup-ingest")
export class WazzupIngestController {
  private readonly logger = new Logger(WazzupIngestController.name);

  constructor(private readonly handler: IncomingMessageHandler) {}

  @Post()
  @HttpCode(200)
  async ingest(@Body() body: unknown): Promise<{ status: string }> {
    if (!body || typeof body !== "object") {
      return { status: "ok" };
    }

    const b = body as Record<string, unknown>;

    const isPing = b["type"] === "ping" || b["event"] === "ping" || Object.keys(b).length === 0;
    if (isPing) {
      this.logger.log("Wazzup verification ping received");
      return { status: "ok" };
    }

    const messages = b["messages"] as Array<Record<string, unknown>> | undefined;

    if (messages && messages.length > 0) {
      this.logger.log(`Received ${messages.length} Wazzup messages`);
      for (const msg of messages) {
        const mappedPayload = this.mapToWebhookPayload(msg);
        if (mappedPayload) {
          await this.handler.handle(mappedPayload);
        }
      }
    } else {
      this.logger.log(`Wazzup event received: ${JSON.stringify(b).slice(0, 300)}`);
      const mapped = this.mapToWebhookPayload(b);
      if (mapped) {
        await this.handler.handle(mapped);
      }
    }

    return { status: "accepted" };
  }

  private mapToWebhookPayload(msg: Record<string, unknown>): Record<string, unknown> | null {
    const phone = msg["phone"] ?? msg["sender"] ?? msg["chatId"] ?? msg["contactPhone"] ?? msg["clientPhone"];
    if (!phone) {
      this.logger.warn("Message without phone, skipping");
      return null;
    }

    return {
      eventId: String(msg["id"] ?? msg["messageId"] ?? ""),
      messageId: String(msg["id"] ?? msg["messageId"] ?? ""),
      direction: msg["direction"] === "outbound" ? "outbound" : "inbound",
      messageType: msg["contentType"] === "image" ? "image" : msg["contentType"] === "video" ? "video" : "text",
      occurredAt: String(msg["timestamp"] ?? msg["createdAt"] ?? new Date().toISOString()),
      contact: {
        id: msg["contactId"] ?? null,
        name: msg["contactName"] ?? msg["senderName"] ?? null,
        phone: String(phone),
      },
      content: {
        text: msg["text"] ?? msg["body"] ?? null,
        attachments: msg["attachments"] ?? msg["media"] ?? [],
      },
    };
  }
}
