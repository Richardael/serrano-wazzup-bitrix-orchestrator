import { Logger } from "@nestjs/common";
import { AppConfig } from "../../infrastructure/config/app.config";
import { normalizePhoneNumber } from "../../infrastructure/config/phone-normalizer";
import { Bitrix24Port } from "../ports/bitrix24.port";
import { LeadRecord } from "../../domain/leads/lead";

/**
 * Título de la actividad. También es la marca que identifica las alertas que
 * crea el orquestador entre las demás actividades del lead: no cambiarlo sin
 * migrar las abiertas.
 */
export const CLIENT_REPLY_ALERT_TITLE = "El cliente respondió por WhatsApp";

/** Entre una notificación y la siguiente del mismo lead, para no avisar por cada mensaje de una ráfaga. */
export const NOTIFY_INTERVAL_MS = 5 * 60 * 1000;

export type ClientReplyAlertResult =
  | "created"
  | "updated"
  | "disabled"
  | "stage_not_alerted"
  | "error";

/** Etapas del lead en las que se avisa, desde la variable separada por comas. */
export function parseAlertStatuses(raw: string): Set<string> {
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

/** Fecha en el formato que acepta Bitrix (ISO 8601 con zona, sin milisegundos). */
export function bitrixDatetime(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "+00:00");
}

const horaCaracas = new Intl.DateTimeFormat("es-VE", {
  timeZone: "America/Caracas",
  hour: "numeric",
  minute: "2-digit",
});

const mensajes = (n: number) => (n === 1 ? "1 mensaje nuevo" : `${n} mensajes nuevos`);

/** Descripción de la alerta; el número del principio es el contador que se lee al actualizarla. */
export function alertDescription(count: number, last: Date): string {
  return (
    `${mensajes(count)} del cliente, el último a las ${horaCaracas.format(last)}. ` +
    "Respóndele desde el chat de Wazzup: la alerta se cierra sola cuando le contestas."
  );
}

/** Mensajes que ya contaba la alerta. Las de antes de que existiera el contador cuentan como uno. */
export function countFromDescription(description: string): number {
  const n = Number(/^(\d+) mensajes? nuevos?/.exec(description.trim())?.[1]);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

/**
 * Avisa en la tarjeta del lead que el cliente escribió por WhatsApp.
 *
 * Crea una actividad pendiente ("to-do") con vencimiento inmediato: Bitrix la
 * cuenta en el contador rojo de la tarjeta del Kanban y del lead. Cada mensaje
 * siguiente la reescribe ("3 mensajes nuevos, el último a las 10:42") y le pone
 * la hora del último, y la responsable recibe una notificación de Bitrix (como
 * mucho una cada `NOTIFY_INTERVAL_MS` por lead). Antes una alerta abierta
 * tapaba los mensajes que llegaban después: la mayoría nunca se completaba y
 * la vendedora no veía nada nuevo.
 *
 * Cuando la vendedora le contesta desde Wazzup la alerta se completa sola
 * (`resolve`).
 *
 * Solo en leads que ya trabaja una vendedora (`CLIENT_REPLY_ALERT_STATUSES`):
 * de "Hablar con asesor" en adelante, y la campaña de reactivación.
 *
 * Falla en silencio (solo deja log): la alerta es una ayuda visual y nunca debe
 * frenar el registro del mensaje ni el resto del flujo.
 */
export class ClientReplyAlertService {
  private readonly logger = new Logger(ClientReplyAlertService.name);
  /**
   * Trabajo pendiente por lead: los mensajes de una ráfaga se procesan en fila
   * para que el contador no pierda ninguno ni se creen dos alertas.
   */
  private readonly fila = new Map<string, Promise<unknown>>();
  private readonly ultimoAviso = new Map<string, number>();

  constructor(
    private readonly bitrix: Bitrix24Port,
    private readonly config: AppConfig,
    private readonly now: () => Date = () => new Date(),
  ) {}

  get enabled(): boolean {
    return this.config.env.CLIENT_REPLY_ALERT_ENABLED;
  }

  private get etapas(): Set<string> {
    return parseAlertStatuses(this.config.env.CLIENT_REPLY_ALERT_STATUSES);
  }

  async notify(lead: LeadRecord): Promise<ClientReplyAlertResult> {
    if (!this.enabled) return "disabled";
    if (!this.etapas.has(lead.statusId)) return "stage_not_alerted";
    return this.enFila(lead.id, () => this.avisar(lead));
  }

  /**
   * La vendedora le contestó al cliente: completa las alertas abiertas de sus
   * leads. Devuelve cuántas cerró.
   */
  async resolve(rawPhone: string): Promise<number> {
    if (!this.enabled) return 0;
    const digits = rawPhone.replace(/\D/g, "");
    const phone = digits ? normalizePhoneNumber(`+${digits}`) : null;
    if (!phone) return 0;
    try {
      const leads = (await this.bitrix.findLeadsByPhone(phone)).filter((l) => this.etapas.has(l.statusId));
      let cerradas = 0;
      for (const lead of leads) {
        cerradas += await this.enFila(lead.id, () => this.completar(lead.id));
      }
      return cerradas;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`No se pudo cerrar la alerta de respuesta: ${msg}`);
      return 0;
    }
  }

  private enFila<T>(leadId: string, tarea: () => Promise<T>): Promise<T> {
    const anterior = this.fila.get(leadId) ?? Promise.resolve();
    const actual = anterior.catch(() => undefined).then(tarea);
    this.fila.set(leadId, actual);
    void actual
      .catch(() => undefined)
      .finally(() => {
        if (this.fila.get(leadId) === actual) this.fila.delete(leadId);
      });
    return actual;
  }

  private async avisar(lead: LeadRecord): Promise<ClientReplyAlertResult> {
    try {
      const ahora = this.now();
      const abierta = (await this.bitrix.listOpenLeadActivities(lead.id)).find(
        (a) => a.subject === CLIENT_REPLY_ALERT_TITLE,
      );
      const cuenta = abierta ? countFromDescription(abierta.description) + 1 : 1;
      const responsibleId = this.responsableDe(lead);
      const todo = {
        leadId: lead.id,
        title: CLIENT_REPLY_ALERT_TITLE,
        description: alertDescription(cuenta, ahora),
        deadline: bitrixDatetime(ahora),
        ...(responsibleId ? { responsibleId } : {}),
      };

      if (abierta) {
        await this.bitrix.updateLeadTodo(abierta.id, todo);
        this.logger.log(`Alerta de respuesta ${abierta.id} del lead ${lead.id}: ${cuenta} mensajes`);
      } else {
        const activityId = await this.bitrix.addLeadTodo(todo);
        this.logger.log(`Alerta de respuesta ${activityId} creada en el lead ${lead.id}`);
      }

      if (responsibleId) await this.notificar(lead, responsibleId, cuenta, ahora.getTime());
      return abierta ? "updated" : "created";
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`No se pudo crear la alerta de respuesta en el lead ${lead.id}: ${msg}`);
      return "error";
    }
  }

  private async notificar(lead: LeadRecord, userId: string, cuenta: number, ahora: number): Promise<void> {
    const anterior = this.ultimoAviso.get(lead.id);
    if (anterior !== undefined && ahora - anterior < NOTIFY_INTERVAL_MS) return;
    const nombre = (lead.title || `Lead ${lead.id}`).replace(/\[/g, "(").replace(/\]/g, ")");
    try {
      await this.bitrix.notifyUser(
        userId,
        `El cliente de [url=/crm/lead/details/${lead.id}/]${nombre}[/url] te escribió por WhatsApp ` +
          `(${mensajes(cuenta)} sin responder).`,
      );
      this.ultimoAviso.set(lead.id, ahora);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`No se pudo notificar a ${userId} por el lead ${lead.id}: ${msg}`);
    }
  }

  private async completar(leadId: string): Promise<number> {
    const abiertas = (await this.bitrix.listOpenLeadActivities(leadId)).filter(
      (a) => a.subject === CLIENT_REPLY_ALERT_TITLE,
    );
    for (const a of abiertas) {
      await this.bitrix.completeActivity(a.id);
      this.logger.log(`Alerta de respuesta ${a.id} del lead ${leadId} cerrada: la vendedora contestó`);
    }
    this.ultimoAviso.delete(leadId);
    return abiertas.length;
  }

  /** La responsable del lead; si no tiene, la responsable por defecto del portal. */
  private responsableDe(lead: LeadRecord): string | undefined {
    const asignado = lead.assignedById.trim();
    if (asignado && asignado !== "0") return asignado;
    const porDefecto = this.config.env.BITRIX24_DEFAULT_RESPONSIBLE_ID;
    return porDefecto ? String(porDefecto) : undefined;
  }
}
