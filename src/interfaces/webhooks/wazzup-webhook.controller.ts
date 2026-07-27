import {
  Controller,
  Post,
  Param,
  Headers,
  Body,
  HttpCode,
  UnauthorizedException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import { WazzupWebhookSchema } from "./wazzup-webhook.schema";
import { IncomingMessageHandler } from "../../application/services/incoming-message.handler";
import { AppConfig } from "../../infrastructure/config/app.config";
import { Logger } from "@nestjs/common";

@Controller("webhooks/wazzup")
export class WazzupWebhookController {
  private readonly logger = new Logger(WazzupWebhookController.name);

  constructor(
    private readonly handler: IncomingMessageHandler,
    private readonly config: AppConfig,
  ) {}

  @Post(":webhookId")
  @HttpCode(200)
  async receive(
    @Param("webhookId") webhookId: string,
    @Headers("authorization") authorization: string | undefined,
    @Headers("content-type") contentType: string | undefined,
    @Body() body: unknown,
  ): Promise<{ status: string }> {
    if (webhookId !== this.config.env.WAZZUP_WEBHOOK_ID) {
      throw new UnauthorizedException("Invalid webhook ID");
    }

    if (!contentType || !contentType.includes("application/json")) {
      throw new UnsupportedMediaTypeException("Content-Type must be application/json");
    }

    const token = authorization?.replace("Bearer ", "");

    const bodySize = JSON.stringify(body).length;
    if (bodySize > this.config.env.MAX_WEBHOOK_BODY_BYTES) {
      throw new PayloadTooLargeException("Payload exceeds maximum size");
    }

    const isWazzupNative = this.isWazzupNativePayload(body);
    const isTestPing = this.isTestPing(body);

    if (isTestPing) {
      this.logger.log("Wazzup verification ping received");
      return { status: "ok" };
    }

    if (isWazzupNative) {
      return this.handleWazzupNativePayload(body);
    }

    if (!token || token !== this.config.env.WAZZUP_WEBHOOK_BEARER_TOKEN) {
      throw new UnauthorizedException("Invalid bearer token");
    }

    const parsed = WazzupWebhookSchema.safeParse(body);
    if (!parsed.success) {
      this.logger.warn(`Invalid webhook payload: ${parsed.error.message}`);
      return { status: "invalid_payload" };
    }

    const result = await this.handler.handle(parsed.data);
    return { status: result.status };
  }

  private isTestPing(body: unknown): boolean {
    if (!body || typeof body !== "object") return false;
    const b = body as Record<string, unknown>;
    return b["type"] === "ping" || b["event"] === "ping" || Object.keys(b).length === 0;
  }

  private isWazzupNativePayload(body: unknown): boolean {
    if (!body || typeof body !== "object") return false;
    const b = body as Record<string, unknown>;
    return Array.isArray(b["messages"]) || b["event"] === "message" || b["event"] === "message_status";
  }

  private async handleWazzupNativePayload(body: unknown): Promise<{ status: string }> {
    const b = body as Record<string, unknown>;
    const messages = b["messages"] as Array<Record<string, unknown>> | undefined;

    if (messages && messages.length > 0) {
      for (const msg of messages) {
        const mappedPayload = this.mapWazzupMessageToWebhook(msg);
        if (mappedPayload) {
          await this.handler.handle(mappedPayload);
        }
      }
    }

    return { status: "accepted" };
  }

  private mapWazzupMessageToWebhook(msg: Record<string, unknown>): Record<string, unknown> | null {
    const phone = msg["phone"] ?? msg["sender"] ?? msg["chatId"] ?? msg["contactPhone"];
    if (!phone) return null;

    return {
      eventId: msg["id"] ?? msg["messageId"],
      messageId: msg["id"] ?? msg["messageId"],
      direction: msg["direction"] ?? msg["type"] === "incoming" ? "inbound" : "outbound",
      messageType: msg["contentType"] === "image" ? "image" : msg["contentType"] === "video" ? "video" : "text",
      occurredAt: msg["timestamp"] ?? msg["createdAt"] ?? new Date().toISOString(),
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
