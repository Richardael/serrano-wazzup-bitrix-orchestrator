import { Controller, Post, Body, Headers, HttpCode, Logger, UnauthorizedException, Query } from "@nestjs/common";
import { IncomingMessageHandler } from "../../application/services/incoming-message.handler";
import { InternalController } from "../http/internal.controller";
import { BotInboundRelayService } from "../../infrastructure/bot/bot-inbound-relay.service";
import { AppConfig } from "../../infrastructure/config/app.config";
import { bearerTokenMatches } from "../../infrastructure/security/secret-comparison";

@Controller("wazzup-ingest")
export class WazzupIngestController {
  private readonly logger = new Logger(WazzupIngestController.name);

  constructor(
    private readonly handler: IncomingMessageHandler,
    private readonly botRelay: BotInboundRelayService,
    private readonly config: AppConfig,
  ) {}

  @Post()
  @HttpCode(200)
  async ingest(
    @Body() body: unknown,
    @Headers("authorization") authorization?: string,
    @Query("webhookToken") webhookToken?: string,
  ): Promise<{ status: string }> {
    const suppliedAuthorization = authorization ?? (webhookToken ? `Bearer ${webhookToken}` : undefined);
    if (!bearerTokenMatches(suppliedAuthorization, this.config.env.WAZZUP_WEBHOOK_BEARER_TOKEN)) {
      throw new UnauthorizedException("Invalid bearer token");
    }

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

      // The relay is detached so bot availability cannot delay Wazzup or Bitrix processing.
      void this.botRelay.relayInbound(b).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "unknown error";
        this.logger.warn(`Bot relay failed without affecting ingest: ${message}`);
      });

      const sanitized = this.sanitizePayload(b);
      InternalController.lastPayload = {
        receivedAt: new Date().toISOString(),
        keys: Object.keys(b),
        preview: JSON.stringify(b).slice(0, 2000),
        full: sanitized,
      };

      this.logger.log(`RAW WAZZUP PAYLOAD keys: ${Object.keys(b).join(", ")}`);

      const messages = b["messages"] as Array<Record<string, unknown>> | undefined;
      let finalStatus = "no_messages";

      if (messages && messages.length > 0) {
        this.logger.log(`Processing ${messages.length} messages from array`);
        for (const msg of messages) {
          this.logger.log(`Message keys: ${Object.keys(msg).join(", ")}`);

          if (!this.shouldProcess(msg)) {
            this.logger.log(`Skipping message (outbound/echo/duplicate)`);
            continue;
          }

          const mappedPayload = this.mapToWebhookPayload(msg);
          if (mappedPayload) {
            const result = await this.handler.handle(mappedPayload);
            finalStatus = result.status;
          } else {
            this.logger.warn("Could not map message to webhook payload — missing phone");
            finalStatus = "no_phone";
          }
        }
      } else {
        const mapped = this.mapToWebhookPayload(b);
        if (mapped) {
          const result = await this.handler.handle(mapped);
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
    const contact = (msg["contact"] ?? {}) as Record<string, unknown>;

    const phone = contact["phone"] ?? msg["phone"] ?? msg["chatId"]
      ?? msg["chat_id"] ?? msg["contactPhone"] ?? msg["contact_phone"] ?? msg["from"];

    if (!phone) {
      this.logger.warn(`Message without phone. Available keys: ${Object.keys(msg).join(", ")}`);
      return null;
    }

    const chatId = String(msg["chatId"] ?? msg["chat_id"] ?? contact["messengerChatId"] ?? msg["id"] ?? "");
    const channelId = String(msg["channelId"] ?? msg["channel_id"] ?? "");

    return {
      eventId: String(msg["id"] ?? msg["messageId"] ?? msg["message_id"] ?? ""),
      messageId: String(msg["id"] ?? msg["messageId"] ?? msg["message_id"] ?? ""),
      channelId,
      chatId,
      direction: msg["status"] === "outbound" || msg["direction"] === "outbound" || msg["type"] === "outgoing" ? "outbound" : "inbound",
      messageType: msg["contentType"] === "image" || msg["content_type"] === "image" || msg["type"] === "image" ? "image"
        : msg["contentType"] === "video" || msg["content_type"] === "video" || msg["type"] === "video" ? "video" : "text",
      occurredAt: String(msg["dateTime"] ?? msg["timestamp"] ?? msg["createdAt"] ?? msg["created_at"] ?? new Date().toISOString()),
      contact: {
        id: contact["id"] ?? msg["contactId"] ?? msg["contact_id"] ?? null,
        name: contact["name"] ?? msg["contactName"] ?? msg["senderName"] ?? msg["sender_name"] ?? null,
        phone: String(phone),
      },
      content: {
        text: msg["text"] ?? msg["body"] ?? null,
        attachments: msg["attachments"] ?? msg["media"] ?? [],
      },
    };
  }

  private lastProcessed = new Map<string, number>();
  private readonly COOLDOWN_MS = 8000;

  private shouldProcess(msg: Record<string, unknown>): boolean {
    const status = String(msg["status"] ?? msg["direction"] ?? "");
    if (status === "outbound" || status === "outgoing") return false;

    if (msg["isEcho"] === true) return false;

    const chatId = String(msg["chatId"] ?? msg["chat_id"] ?? "");
    const text = String(msg["text"] ?? msg["body"] ?? "");
    if (!chatId || !text) return false;

    const hash = `${chatId}:${text.slice(0, 80)}`;
    const last = this.lastProcessed.get(hash);
    const now = Date.now();
    if (last && (now - last) < this.COOLDOWN_MS) return false;

    this.lastProcessed.set(hash, now);

    if (this.lastProcessed.size > 1000) {
      const cutoff = now - 60000;
      for (const [k, t] of this.lastProcessed) {
        if (t < cutoff) this.lastProcessed.delete(k);
      }
    }

    return true;
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
