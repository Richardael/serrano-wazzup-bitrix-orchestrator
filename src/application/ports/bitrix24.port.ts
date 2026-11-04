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
  /** Actividades sin completar del lead (llamadas, tareas, to-dos...). */
  listOpenLeadActivities(leadId: string): Promise<LeadActivity[]>;
  /** Crea una actividad pendiente ("to-do") en el lead. Devuelve su ID. */
  addLeadTodo(input: AddLeadTodoInput): Promise<string>;
  /**
   * Reescribe un to-do del lead. Bitrix borra lo que no se manda (el título
   * incluido), así que van todos los campos.
   */
  updateLeadTodo(activityId: string, input: AddLeadTodoInput): Promise<void>;
  /** Marca una actividad como completada. */
  completeActivity(activityId: string): Promise<void>;
  /** Notificación de sistema (la campana de Bitrix) a un usuario. Admite BBCode. */
  notifyUser(userId: string, message: string): Promise<void>;
}

export interface LeadActivity {
  readonly id: string;
  readonly subject: string;
  readonly description: string;
}

export interface AddLeadTodoInput {
  leadId: string;
  title: string;
  description: string;
  /** ISO 8601 con zona, p. ej. 2026-10-27T15:00:00+00:00. */
  deadline: string;
  responsibleId?: string;
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
