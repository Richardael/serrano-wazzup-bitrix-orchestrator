import { Injectable, Logger } from "@nestjs/common";
import { AppConfig } from "../../infrastructure/config/app.config";
import { Bitrix24Port } from "../ports/bitrix24.port";
import { EventRepository } from "../ports/event-repository.port";
import { PhoneLinkRepository } from "../ports/phone-link-repository.port";
import { QueuePort } from "../ports/queue.port";
import { NormalizedIncomingMessage } from "../../domain/messages/normalized-message";
import {
  normalizePhoneNumber,
  extractPhoneCountry,
  maskPhoneForLog,
} from "../../infrastructure/config/phone-normalizer";

const INACTIVE_LEAD_STATUSES = new Set(["CONVERTED", "JUNK"]);
const PROVIDER = "WAZZUP";

interface ProcessMessageJob {
  eventId: string;
  normalizedPhone: string;
  direction: string;
  messageType: string;
  contactName: string | null;
}

@Injectable()
export class ProcessIncomingMessageUseCase {
  private readonly logger = new Logger(ProcessIncomingMessageUseCase.name);

  constructor(
    private readonly config: AppConfig,
    private readonly bitrix24: Bitrix24Port,
    private readonly eventRepo: EventRepository,
    private readonly phoneLinkRepo: PhoneLinkRepository,
    private readonly queue: QueuePort,
  ) {}

  async execute(
    message: NormalizedIncomingMessage,
    eventId: string,
  ): Promise<void> {
    const maskedPhone = maskPhoneForLog(message.contact.normalizedPhone);
    this.logger.log(`Processing message for ${maskedPhone} [event=${eventId}]`);

    try {
      await this.eventRepo.updateStatus(eventId, "PROCESSING");

      const normalizedPhone = message.contact.normalizedPhone;
      const contactId = await this.bitrix24.upsertContact({
        name: message.contact.displayName?.trim() || normalizedPhone,
        phone: normalizedPhone,
      });

      const leads = await this.bitrix24.findLeadsByPhone(normalizedPhone);

      if (leads.length === 0) {
        this.logger.log(
          `No leads found for ${maskedPhone}. Creating new lead.`,
        );
        await this.createNewLead(message, eventId, normalizedPhone, contactId);
        await this.eventRepo.updateStatus(eventId, "COMPLETED");
        return;
      }

      const activeLeads = leads.filter(
        (l) => !INACTIVE_LEAD_STATUSES.has(l.statusId),
      );
      const inactiveLeads = leads.filter((l) =>
        INACTIVE_LEAD_STATUSES.has(l.statusId),
      );

      if (activeLeads.length === 1) {
        this.logger.log(
          `Reusing active lead ${activeLeads[0]!.id} for ${maskedPhone}`,
        );
        await this.bitrix24.updateLead(activeLeads[0]!.id, { contactId });
        await this.linkPhoneToLead(normalizedPhone, activeLeads[0]!.id);
      } else if (activeLeads.length === 0 && inactiveLeads.length > 0) {
        this.logger.log(
          `All leads closed for ${maskedPhone}. Creating new lead.`,
        );
        await this.createNewLead(message, eventId, normalizedPhone, contactId);
      } else if (activeLeads.length > 1) {
        this.logger.warn(
          `Multiple active leads (${activeLeads.length}) for ${maskedPhone}. Flagging manual review.`,
        );
        await this.eventRepo.updateStatus(
          eventId,
          "MANUAL_REVIEW",
          "MULTIPLE_ACTIVE_LEADS",
          `Found ${activeLeads.length} active leads for phone: [${activeLeads.map((l) => l.id).join(", ")}]`,
        );
      } else {
        await this.createNewLead(message, eventId, normalizedPhone, contactId);
      }

      await this.eventRepo.updateStatus(eventId, "COMPLETED");
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Processing failed for event ${eventId}: ${errorMessage}`,
      );
      await this.eventRepo.updateStatus(
        eventId,
        "FAILED",
        "PROCESSING_ERROR",
        errorMessage,
      );
    }
  }

  private async createNewLead(
    message: NormalizedIncomingMessage,
    eventId: string,
    normalizedPhone: string,
    contactId: string,
  ): Promise<void> {
    const title = this.buildLeadTitle(message);

    const leadId = await this.bitrix24.createLead({
      title,
      name: message.contact.displayName ?? null,
      lastName: null,
      phone: normalizedPhone,
      email: null,
      statusId: "NEW",
      sourceId: "WHATSAPP",
      contactId,
      comments: `[WhatsApp] Mensaje recibido — ${new Date().toISOString()}`,
      ufFields: {},
    });

    this.logger.log(
      `Created unassigned lead ${leadId} for ${maskPhoneForLog(normalizedPhone)}`,
    );

    await this.linkPhoneToLead(normalizedPhone, leadId);
  }

  private buildLeadTitle(message: NormalizedIncomingMessage): string {
    const name = message.contact.displayName ?? message.contact.normalizedPhone;
    return `WhatsApp / ${name}`;
  }

  private async linkPhoneToLead(
    normalizedPhone: string,
    leadId: string,
  ): Promise<void> {
    const country = extractPhoneCountry(normalizedPhone);
    await this.phoneLinkRepo.upsert(normalizedPhone, country, leadId);
  }
}
