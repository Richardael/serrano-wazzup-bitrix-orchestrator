import { Injectable, Logger } from "@nestjs/common";
import { v4 as uuid } from "uuid";
import { createHash } from "crypto";
import { AppConfig } from "../../infrastructure/config/app.config";
import { EventRepository } from "../../application/ports/event-repository.port";
import { QueuePort } from "../../application/ports/queue.port";
import { WazzupWebhookPayload } from "../../interfaces/webhooks/wazzup-webhook.schema";
import { NormalizedIncomingMessage } from "../../domain/messages/normalized-message";
import { normalizePhoneNumber, maskPhoneForLog } from "../../infrastructure/config/phone-normalizer";

const EVENT_RETENTION_WINDOW_MS = 5 * 60 * 1000;
const PROVIDER = "WAZZUP";

interface ProcessMessageJobPayload {
  eventId: string;
  normalizedPhone: string;
  direction: string;
  messageType: string;
  contactName: string | null;
  [key: string]: unknown;
}

@Injectable()
export class IncomingMessageHandler {
  private readonly logger = new Logger(IncomingMessageHandler.name);

  constructor(
    private readonly config: AppConfig,
    private readonly eventRepo: EventRepository,
    private readonly queue: QueuePort,
  ) {}

  async handle(payload: WazzupWebhookPayload): Promise<{ status: string; eventId?: string }> {
    if (payload.test === true) {
      this.logger.log("Test webhook received — acknowledged");
      return { status: "test_acknowledged" };
    }

    const normalizedMessage = this.normalizePayload(payload);

    if (!normalizedMessage) {
      this.logger.warn("Unable to normalize webhook payload");
      return { status: "invalid_payload" };
    }

    const maskedPhone = maskPhoneForLog(normalizedMessage.contact.normalizedPhone);
    const correlationId = uuid();
    const payloadHash = this.computeHash(JSON.stringify(payload));
    const since = new Date(Date.now() - EVENT_RETENTION_WINDOW_MS);

    if (normalizedMessage.providerEventId) {
      const existing = await this.eventRepo.findByProviderEventId(PROVIDER, normalizedMessage.providerEventId);
      if (existing) {
        this.logger.log(`Duplicate event ${normalizedMessage.providerEventId} — skipping`);
        return { status: "duplicate", eventId: existing.id };
      }
    }

    const hashDuplicate = await this.eventRepo.findByPayloadHash(PROVIDER, payloadHash, since);
    if (hashDuplicate) {
      this.logger.log(`Hash duplicate for ${maskedPhone} — skipping`);
      return { status: "duplicate", eventId: hashDuplicate.id };
    }

    const event = await this.eventRepo.create({
      provider: PROVIDER,
      providerEventId: normalizedMessage.providerEventId,
      eventType: `message.${normalizedMessage.direction}`,
      payloadHash,
      sanitizedPayload: this.config.env.STORE_MESSAGE_BODY
        ? (payload as unknown as Record<string, unknown>)
        : null,
      status: "RECEIVED",
      attempts: 0,
      correlationId,
      receivedAt: new Date(),
      processingStartedAt: null,
      processedAt: null,
      nextRetryAt: null,
      errorCode: null,
      errorMessage: null,
    });

    this.logger.log(`Event ${event.id} received for ${maskedPhone} [corr=${correlationId}]`);

    const jobPayload: ProcessMessageJobPayload = {
      eventId: event.id,
      normalizedPhone: normalizedMessage.contact.normalizedPhone,
      direction: normalizedMessage.direction,
      messageType: normalizedMessage.messageType,
      contactName: normalizedMessage.contact.displayName,
    };

    await this.queue.enqueue("process-incoming-message", jobPayload);

    return { status: "accepted", eventId: event.id };
  }

  private normalizePayload(payload: WazzupWebhookPayload): NormalizedIncomingMessage | null {
    const rawPhone = payload.contact?.phone;
    if (!rawPhone) {
      this.logger.warn("No phone in webhook payload");
      return null;
    }

    const normalizedPhone = normalizePhoneNumber(rawPhone);
    if (!normalizedPhone) {
      this.logger.warn(`Invalid phone number: ${maskPhoneForLog(rawPhone)}`);
      return null;
    }

    return {
      providerEventId: payload.eventId ?? "",
      providerMessageId: payload.messageId ?? null,
      channelId: payload.channelId ?? null,
      direction: payload.direction ?? "inbound",
      messageType: payload.messageType ?? "text",
      occurredAt: payload.occurredAt ?? new Date().toISOString(),
      contact: {
        externalId: payload.contact?.id ?? null,
        displayName: payload.contact?.name ?? null,
        rawPhone,
        normalizedPhone,
      },
      content: {
        hasText: Boolean(payload.content?.text),
        textHash: payload.content?.text ? this.computeHash(payload.content.text) : null,
        hasAttachments: Array.isArray(payload.content?.attachments) && payload.content!.attachments!.length > 0,
      },
      rawMetadata: null,
    };
  }

  private computeHash(input: string): string {
    return createHash("sha256").update(input).digest("hex").slice(0, 64);
  }
}
