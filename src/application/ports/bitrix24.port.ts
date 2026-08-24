import { LeadRecord } from "../../domain/leads/lead";

export interface Bitrix24Port {
  testConnection(): Promise<boolean>;
  upsertContact(input: UpsertContactInput): Promise<string>;
  deleteContact(contactId: string): Promise<void>;
  findLeadsByPhone(normalizedPhone: string): Promise<LeadRecord[]>;
  getLead(leadId: string): Promise<LeadRecord | null>;
  createLead(input: CreateLeadInput): Promise<string>;
  updateLead(leadId: string, fields: LeadUpdateFields): Promise<void>;
  getLeadStatuses(): Promise<BitrixStatus[]>;
  getLeadSources(): Promise<BitrixStatus[]>;
}

export interface LeadUpdateFields {
  title?: string;
  statusId?: string;
  assignedById?: string;
  comments?: string | null;
  contactId?: string;
  companyId?: string;
  ufFields?: Record<string, string | number | boolean | null>;
  extraParams?: Record<string, string>;
}

export interface CreateLeadInput {
  title: string;
  name: string | null;
  lastName: string | null;
  phone: string;
  email: string | null;
  statusId: string;
  sourceId: string;
  assignedById?: string;
  contactId?: string;
  companyId?: string;
  comments: string | null;
  ufFields: Record<string, string | number | boolean | null>;
}

export interface UpsertContactInput {
  name: string;
  phone: string;
}

export interface BitrixStatus {
  readonly statusId: string;
  readonly name: string;
  readonly semantics: string | null;
}
