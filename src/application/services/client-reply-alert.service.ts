import { Logger } from "@nestjs/common";
import { AppConfig } from "../../infrastructure/config/app.config";
import { Bitrix24Port } from "../ports/bitrix24.port";
import { LeadRecord } from "../../domain/leads/lead";

/**
 * Título de la actividad. También es la marca que identifica las alertas que
 * crea el orquestador entre las demás actividades del lead: no cambiarlo sin
 * migrar las abiertas.
 */
export const CLIENT_REPLY_ALERT_TITLE = "El cliente respondió por WhatsApp";

const CLIENT_REPLY_ALERT_DESCRIPTION =
  "El cliente escribió por WhatsApp. Respóndele desde el chat de Wazzup y marca esta actividad como completada.";

export type ClientReplyAlertResult =
  | "created"
  | "already_open"
  | "in_flight"
  | "disabled"
  | "error";

/** Fecha en el formato que acepta Bitrix (ISO 8601 con zona, sin milisegundos). */
export function bitrixDatetime(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "+00:00");
}

/**
 * Avisa en la tarjeta del lead que el cliente respondió por WhatsApp.
 *
 * Crea una actividad pendiente ("to-do") con vencimiento inmediato: Bitrix la
 * cuenta en el contador rojo de la tarjeta del Kanban y del lead, y la vendedora
 * la ve sin abrir el chat. Al completarla, el contador se apaga.
 *
 * Mientras haya una alerta abierta no se crea otra: varios mensajes seguidos del
 * mismo cliente dejan una sola actividad, no una por mensaje.
 *
 * Falla en silencio (solo deja log): la alerta es una ayuda visual y nunca debe
 * frenar el registro del mensaje ni el resto del flujo.
 */
export class ClientReplyAlertService {
  private readonly logger = new Logger(ClientReplyAlertService.name);
  /** Leads con una alerta en curso en este proceso: evita duplicados por mensajes simultáneos. */
  private readonly enCurso = new Set<string>();

  constructor(
    private readonly bitrix: Bitrix24Port,
    private readonly config: AppConfig,
    private readonly now: () => Date = () => new Date(),
  ) {}

  get enabled(): boolean {
    return this.config.env.CLIENT_REPLY_ALERT_ENABLED;
  }

  async notify(lead: LeadRecord): Promise<ClientReplyAlertResult> {
    if (!this.enabled) return "disabled";
    if (this.enCurso.has(lead.id)) return "in_flight";

    this.enCurso.add(lead.id);
    try {
      const abiertas = await this.bitrix.listOpenLeadActivities(lead.id);
      if (abiertas.some((a) => a.subject === CLIENT_REPLY_ALERT_TITLE)) {
        return "already_open";
      }

      const responsibleId = this.responsableDe(lead);
      const activityId = await this.bitrix.addLeadTodo({
        leadId: lead.id,
        title: CLIENT_REPLY_ALERT_TITLE,
        description: CLIENT_REPLY_ALERT_DESCRIPTION,
        deadline: bitrixDatetime(this.now()),
        ...(responsibleId ? { responsibleId } : {}),
      });
      this.logger.log(`Alerta de respuesta ${activityId} creada en el lead ${lead.id}`);
      return "created";
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`No se pudo crear la alerta de respuesta en el lead ${lead.id}: ${msg}`);
      return "error";
    } finally {
      this.enCurso.delete(lead.id);
    }
  }

  /** La responsable del lead; si no tiene, la responsable por defecto del portal. */
  private responsableDe(lead: LeadRecord): string | undefined {
    const asignado = lead.assignedById.trim();
    if (asignado && asignado !== "0") return asignado;
    const porDefecto = this.config.env.BITRIX24_DEFAULT_RESPONSIBLE_ID;
    return porDefecto ? String(porDefecto) : undefined;
  }
}
