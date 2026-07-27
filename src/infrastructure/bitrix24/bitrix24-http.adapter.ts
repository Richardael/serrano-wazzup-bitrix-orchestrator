import { Injectable } from "@nestjs/common";
import { AppConfig } from "../config/app.config";
import { Bitrix24Port, CreateLeadInput, BitrixStatus, LeadUpdateFields } from "../../application/ports/bitrix24.port";
import { LeadRecord } from "../../domain/leads/lead";
import { maskPhoneForLog } from "../config/phone-normalizer";

interface BitrixResponse<T> {
  result: T;
  total?: number;
  time?: Record<string, unknown>;
  error?: string;
  error_description?: string;
}

@Injectable()
export class Bitrix24HttpAdapter implements Bitrix24Port {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  constructor(config: AppConfig) {
    this.baseUrl = config.env.BITRIX24_WEBHOOK_BASE_URL.replace(/\/+$/, "");
    this.timeoutMs = 15000;
    this.maxRetries = 3;
  }

  async testConnection(): Promise<boolean> {
    const data = await this.request<{ ID: string }>("profile.json");
    return Boolean(data.result?.ID);
  }

  async findLeadsByPhone(normalizedPhone: string): Promise<LeadRecord[]> {
    const params: Record<string, unknown> = {
      entity_type: "LEAD",
      type: "PHONE",
    };
    params["values[0]"] = normalizedPhone;

    const data = await this.request<Record<string, number[]>>("crm.duplicate.findbycomm.json", params);

    const leadIds = data.result?.["LEAD"] ?? [];
    const records: LeadRecord[] = [];

    for (const id of leadIds) {
      const lead = await this.getLead(String(id));
      if (lead) {
        records.push(lead);
      }
    }

    return records;
  }

  async getLead(leadId: string): Promise<LeadRecord | null> {
    const data = await this.request<Record<string, unknown>>("crm.lead.get.json", { id: leadId });

    if (!data.result) {
      return null;
    }

    const lead = data.result;
    const phones = this.extractPhones(lead);

    return {
      id: String(lead["ID"] ?? ""),
      title: String(lead["TITLE"] ?? ""),
      statusId: String(lead["STATUS_ID"] ?? ""),
      assignedById: String(lead["ASSIGNED_BY_ID"] ?? ""),
      sourceId: String(lead["SOURCE_ID"] ?? ""),
      phone: String(phones[0] ?? ""),
      createdAt: String(lead["DATE_CREATE"] ?? ""),
    };
  }

  async createLead(input: CreateLeadInput): Promise<string> {
    const fields: Record<string, unknown> = {
      TITLE: input.title,
      STATUS_ID: input.statusId,
      SOURCE_ID: input.sourceId,
      ASSIGNED_BY_ID: input.assignedById,
      ...input.ufFields,
    };

    if (input.name) {
      fields["NAME"] = input.name;
    }

    if (input.lastName) {
      fields["LAST_NAME"] = input.lastName;
    }

    if (input.phone) {
      fields["PHONE"] = [{ VALUE: input.phone, VALUE_TYPE: "WORK" }];
    }

    if (input.email) {
      fields["EMAIL"] = [{ VALUE: input.email, VALUE_TYPE: "WORK" }];
    }

    if (input.comments) {
      fields["COMMENTS"] = input.comments;
    }

    const data = await this.request<number>("crm.lead.add.json", { fields });

    if (data.error) {
      throw new Error(`Bitrix24 error: ${data.error} - ${data.error_description}`);
    }

    return String(data.result);
  }

  async updateLead(leadId: string, fields: LeadUpdateFields): Promise<void> {
    const params: Record<string, unknown> = { id: leadId };

    if (fields.title) {
      params["fields[TITLE]"] = fields.title;
    }
    if (fields.statusId) {
      params["fields[STATUS_ID]"] = fields.statusId;
    }
    if (fields.comments !== undefined) {
      params["fields[COMMENTS]"] = fields.comments;
    }
    if (fields.ufFields) {
      for (const [key, value] of Object.entries(fields.ufFields)) {
        if (value !== null && value !== undefined) {
          params[`fields[${key}]`] = value;
        }
      }
    }
    if (fields.extraParams) {
      for (const [key, value] of Object.entries(fields.extraParams)) {
        params[key] = value;
      }
    }

    const data = await this.request<boolean>("crm.lead.update.json", params);
    if (data.error) {
      throw new Error(`Bitrix24 update error: ${data.error}`);
    }
  }

  async getLeadStatuses(): Promise<BitrixStatus[]> {
    const data = await this.request<Array<{ STATUS_ID: string; NAME: string; EXTRA?: { SEMANTICS?: string } }>>(
      "crm.status.entity.items.json",
      { ENTITY_ID: "STATUS" },
    );

    return (data.result ?? []).map((s) => ({
      statusId: s.STATUS_ID,
      name: s.NAME,
      semantics: s.EXTRA?.SEMANTICS ?? null,
    }));
  }

  async getLeadSources(): Promise<BitrixStatus[]> {
    const data = await this.request<Array<{ STATUS_ID: string; NAME: string; EXTRA?: { SEMANTICS?: string } }>>(
      "crm.status.entity.items.json",
      { ENTITY_ID: "SOURCE" },
    );

    return (data.result ?? []).map((s) => ({
      statusId: s.STATUS_ID,
      name: s.NAME,
      semantics: s.EXTRA?.SEMANTICS ?? null,
    }));
  }

  private async request<T>(method: string, params?: Record<string, unknown>): Promise<BitrixResponse<T>> {
    const url = `${this.baseUrl}/${method}`;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

        const body = this.buildFormBody(params ?? {});

        const start = Date.now();
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: body,
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        const duration = Date.now() - start;

        if (response.status === 429) {
          const retryAfter = parseInt(response.headers.get("Retry-After") ?? "5", 10);
          await this.delay(retryAfter * 1000 + Math.random() * 1000);
          continue;
        }

        if (!response.ok && response.status >= 500) {
          if (attempt < this.maxRetries - 1) {
            await this.delay((Math.pow(2, attempt) * 1000) + Math.random() * 1000);
            continue;
          }
        }

        const json = (await response.json()) as BitrixResponse<T>;
        return json;
      } catch (err: unknown) {
        lastError = err instanceof Error ? err : new Error(String(err));

        if (attempt < this.maxRetries - 1) {
          await this.delay((Math.pow(2, attempt) * 1000) + Math.random() * 500);
        }
      }
    }

    throw lastError ?? new Error("Unknown error in Bitrix24 request");
  }

  private buildFormBody(params: Record<string, unknown>): string {
    const parts: string[] = [];
    this.flattenParams(params, "", parts);
    return parts.join("&");
  }

  private flattenParams(obj: unknown, prefix: string, parts: string[]): void {
    if (obj === null || obj === undefined) return;

    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        this.flattenParams(obj[i], `${prefix}[${i}]`, parts);
      }
    } else if (typeof obj === "object") {
      for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        const newPrefix = prefix ? `${prefix}[${key}]` : key;
        this.flattenParams(value, newPrefix, parts);
      }
    } else {
      parts.push(`${prefix}=${encodeURIComponent(String(obj))}`);
    }
  }

  private extractPhones(record: Record<string, unknown>): string[] {
    const phoneField = record["PHONE"];
    if (!phoneField) return [];

    if (typeof phoneField === "string") {
      return [phoneField];
    }

    if (Array.isArray(phoneField)) {
      return phoneField
        .filter(
          (p): p is { VALUE: string } =>
            typeof p === "object" && p !== null && typeof (p as Record<string, unknown>)["VALUE"] === "string",
        )
        .map((p) => p.VALUE);
    }

    return [];
  }

  private phoneMatches(phones: string[], normalizedPhone: string): boolean {
    return phones.some((phone) => {
      const stripped = phone.replace(/[\s\-().]/g, "");
      return stripped === normalizedPhone || stripped === normalizedPhone.replace(/^\+/, "");
    });
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
