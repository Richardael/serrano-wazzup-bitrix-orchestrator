import { Injectable, Logger, Inject } from "@nestjs/common";
import { v4 as uuid } from "uuid";
import { createHash } from "crypto";
import { AppConfig } from "../../infrastructure/config/app.config";
import { EventRepository } from "../../application/ports/event-repository.port";
import { QueuePort } from "../../application/ports/queue.port";
import { Bitrix24Port } from "../../application/ports/bitrix24.port";
import { PhoneLinkRepository } from "../../application/ports/phone-link-repository.port";
import { WazzupWebhookPayload } from "../../interfaces/webhooks/wazzup-webhook.schema";
import { NormalizedIncomingMessage } from "../../domain/messages/normalized-message";
import { normalizePhoneNumber, maskPhoneForLog } from "../../infrastructure/config/phone-normalizer";
import { ChatbotService } from "./chatbot.service";
import { CatalogChatbotService } from "./catalog-chatbot.service";
import { WazzupPort } from "../../application/ports/wazzup.port";

const EVENT_RETENTION_WINDOW_MS = 5 * 60 * 1000;
const PROVIDER = "WAZZUP";
const INACTIVE_LEAD_STATUSES = new Set(["CONVERTED", "JUNK"]);

const VENDOR_NAMES: Record<number, string> = {
  206: "Tahi",
  268: "Sabrina",
  308: "Paola",
};

function vendorShortName(vendorId: number): string {
  return VENDOR_NAMES[vendorId] ?? String(vendorId);
}

function buildLeadTitle(contactName: string | null, phone: string, vendorId: number): string {
  const name = contactName ?? phone;
  const vendor = vendorShortName(vendorId);
  return `WhatsApp / ${name} / ${vendor}`;
}

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
  private vendorRoundRobin = 0;
  private lastVendorId = 0;

  constructor(
    private readonly config: AppConfig,
    private readonly eventRepo: EventRepository,
    private readonly queue: QueuePort,
    private readonly bitrix24: Bitrix24Port,
    private readonly phoneLinkRepo: PhoneLinkRepository,
    private readonly chatbot: ChatbotService,
    private readonly catalogChatbot: CatalogChatbotService,
    @Inject("WAZZUP_PORT") private readonly wazzupPort: WazzupPort,
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
    const chatId = (payload as Record<string, unknown>)["chatId"] as string | undefined;
    const contentObj = ((payload as Record<string, unknown>)["content"] ?? {}) as Record<string, unknown>;
    const messageText = contentObj["text"] as string | undefined;
    const channelId = (payload as Record<string, unknown>)["channelId"] as string | undefined;

    try {
      const result = await this.handleWithDb(payload, normalizedMessage, maskedPhone);
      await this.callChatbot(result, normalizedMessage, messageText, chatId, channelId);
      return result;
    } catch (dbErr: unknown) {
      const dbMsg = dbErr instanceof Error ? dbErr.message : String(dbErr);
      this.logger.warn(`DB unavailable (${dbMsg}) — processing message directly for ${maskedPhone}`);
      const result = await this.handleDirect(normalizedMessage, maskedPhone);
      await this.callChatbot(result, normalizedMessage, messageText, chatId, channelId);
      return result;
    }
  }

  private async callChatbot(
    result: { status: string; eventId?: string },
    msg: NormalizedIncomingMessage,
    messageText: string | undefined,
    chatId: string | undefined,
    channelId: string | undefined,
  ): Promise<void> {
    if (!chatId || !channelId || !channelId.startsWith("f207")) return;
    if (!process.env["OPENROUTER_API_KEY"]) return;

    const leadId = result.eventId ?? "";
    const isNew = result.status === "lead_created";

    if (this.config.env.CATALOG_CHATBOT_ENABLED) {
      const catalogResponse = await this.catalogChatbot.handleMessage(
        msg.contact.displayName, messageText ?? "", chatId, channelId, this.lastVendorId, leadId,
      ).catch((e: unknown) => { this.logger.error(`Catalog chatbot error: ${e}`); return null; });

      if (catalogResponse) {
        await this.wazzupPort.sendMessage({ chatId, channelId, text: catalogResponse }).catch(() => {});
        return;
      }
    }

    this.chatbot.handleMessage(
      msg.contact.displayName, messageText ?? "", chatId, channelId, this.lastVendorId, isNew, leadId,
    ).catch((e: unknown) => this.logger.error(`Chatbot error: ${e}`));
  }

  private async handleWithDb(
    payload: WazzupWebhookPayload,
    normalizedMessage: NormalizedIncomingMessage,
    maskedPhone: string,
  ): Promise<{ status: string; eventId?: string }> {
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

    const directResult = await this.handleDirect(normalizedMessage, maskedPhone);

    return { status: directResult.status, eventId: directResult.eventId ?? event.id };
  }

  private async handleDirect(
    normalizedMessage: NormalizedIncomingMessage,
    maskedPhone: string,
  ): Promise<{ status: string; eventId?: string }> {
    const normalizedPhone = normalizedMessage.contact.normalizedPhone;

    const leads = await this.bitrix24.findLeadsByPhone(normalizedPhone);

    if (leads.length === 0) {
      this.logger.log(`No leads for ${maskedPhone} — creating new lead directly`);
      const vendorId = this.getNextVendor();
      const title = buildLeadTitle(normalizedMessage.contact.displayName, normalizedPhone, vendorId);

      const leadId = await this.bitrix24.createLead({
        title,
        name: normalizedMessage.contact.displayName ?? null,
        lastName: null,
        phone: normalizedPhone,
        email: null,
        statusId: this.config.env.BITRIX24_LEAD_INITIAL_STATUS,
        sourceId: "WHATSAPP",
        assignedById: String(vendorId),
        comments: `[WhatsApp] Mensaje recibido — ${new Date().toISOString()}`,
        ufFields: {},
      });

      this.logger.log(`Created lead ${leadId} for ${maskedPhone}, vendor ${vendorId}`);
      return { status: "lead_created", eventId: leadId };
    }

    const activeLeads = leads.filter((l) => !INACTIVE_LEAD_STATUSES.has(l.statusId));

    if (activeLeads.length === 1) {
      this.logger.log(`Reusing active lead ${activeLeads[0]!.id} for ${maskedPhone}`);
      return { status: "lead_reused", eventId: activeLeads[0]!.id };
    }

    if (activeLeads.length === 0) {
      this.logger.log(`All leads closed for ${maskedPhone} — creating new lead`);
      const vendorId = this.getNextVendor();
      const title = buildLeadTitle(normalizedMessage.contact.displayName, normalizedPhone, vendorId);

      const leadId = await this.bitrix24.createLead({
        title,
        name: normalizedMessage.contact.displayName ?? null,
        lastName: null,
        phone: normalizedPhone,
        email: null,
        statusId: this.config.env.BITRIX24_LEAD_INITIAL_STATUS,
        sourceId: "WHATSAPP",
        assignedById: String(vendorId),
        comments: `[WhatsApp] Mensaje recibido — ${new Date().toISOString()}`,
        ufFields: {},
      });

      this.logger.log(`Created lead ${leadId} for ${maskedPhone}`);
      return { status: "lead_created", eventId: leadId };
    }

    this.logger.warn(`Multiple active leads (${activeLeads.length}) for ${maskedPhone}`);
    return { status: "manual_review" };
  }

  private getNextVendor(): number {
    const vendorIds = this.config.vendorIds;
    const index = this.vendorRoundRobin % vendorIds.length;
    this.vendorRoundRobin++;
    const vendorId = vendorIds[index] ?? vendorIds[0] ?? 1;
    this.lastVendorId = vendorId;
    return vendorId;
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
