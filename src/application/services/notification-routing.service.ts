import { Inject, Injectable, Logger } from "@nestjs/common";
import { AppConfig } from "../../infrastructure/config/app.config";
import { maskPhoneForLog, normalizePhoneNumber } from "../../infrastructure/config/phone-normalizer";
import {
  NOTIFICATION_MARKER_REPOSITORY,
  NotificationMarker,
  NotificationMarkerRepository,
} from "../ports/notification-marker.port";

type RawMessage = Record<string, unknown>;

export interface SuppressedReply {
  message: RawMessage;
  marker: NotificationMarker;
}

export interface RoutingDecision {
  /** Mensajes que siguen el camino de siempre (bot y Bitrix). */
  forward: RawMessage[];
  /** Respuestas a una notificacion reciente: NO entran al flujo de leads. */
  suppressed: SuppressedReply[];
}

/**
 * Telefono canonico para comparar: solo digitos con codigo de pais. Acepta lo que
 * llegue (chatId de Wazzup, "+58 412...", "0412..."). `null` si no parece un telefono.
 */
export function notificationPhoneKey(raw: unknown): string | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const text = String(raw).trim();
  if (!text) return null;
  const e164 = normalizePhoneNumber(text.startsWith("+") ? text : `+${text.replace(/\D/g, "")}`);
  const viaLibrary = e164 ?? normalizePhoneNumber(text);
  if (viaLibrary) return viaLibrary.replace(/\D/g, "");
  const digits = text.replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

/** Mensaje escrito por el cliente: ni eco ni saliente. Mismo criterio que el relevo al bot. */
export function isCustomerMessage(message: RawMessage): boolean {
  if (message["isEcho"] === true) return false;
  const status = String(message["status"] ?? message["direction"] ?? "");
  if (status === "outbound" || status === "outgoing") return false;
  // Estados de entrega de un mensaje saliente: nunca son del cliente.
  if (["sent", "delivered", "read", "error"].includes(status)) return false;
  return true;
}

function phoneOf(message: RawMessage): unknown {
  const contact = (message["contact"] ?? {}) as RawMessage;
  return message["chatId"] ?? message["chat_id"] ?? contact["phone"] ?? message["phone"];
}

/**
 * Decide si la respuesta de un cliente pertenece a una NOTIFICACION que le
 * enviamos (AppSB) y no al flujo de leads.
 *
 * El numero es el mismo para los dos flujos, asi que no se puede distinguir por
 * canal. Quien envia la notificacion la REGISTRA (`register`); mientras la marca
 * este vigente, lo que el cliente conteste no va al bot ni crea o reutiliza leads.
 * Una persona lo atiende desde Wazzup.
 *
 * Falla ABIERTO: si no se puede consultar la base, el mensaje sigue como siempre.
 * Es peor perder el mensaje de un lead nuevo que dejar que el bot hable con un
 * cliente.
 */
@Injectable()
export class NotificationRoutingService {
  private readonly logger = new Logger(NotificationRoutingService.name);

  constructor(
    private readonly config: AppConfig,
    @Inject(NOTIFICATION_MARKER_REPOSITORY) private readonly repo: NotificationMarkerRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  get enabled(): boolean {
    return this.config.env.NOTIFICATION_ROUTING_ENABLED;
  }

  get windowMs(): number {
    return this.config.env.NOTIFICATION_REPLY_WINDOW_HOURS * 3_600_000;
  }

  async register(input: { phone: string; source: string; messageId?: string | null }): Promise<{ expiresAt: Date } | null> {
    const phoneKey = notificationPhoneKey(input.phone);
    if (!phoneKey) return null;
    const sentAt = this.now();
    await this.repo.register({ phoneKey, source: input.source, messageId: input.messageId ?? null, sentAt });
    return { expiresAt: new Date(sentAt.getTime() + this.windowMs) };
  }

  async partition(messages: readonly RawMessage[]): Promise<RoutingDecision> {
    const all = [...messages];
    if (!this.enabled) return { forward: all, suppressed: [] };

    const candidates = all
      .filter(isCustomerMessage)
      .map((message) => ({ message, key: notificationPhoneKey(phoneOf(message)) }))
      .filter((c): c is { message: RawMessage; key: string } => c.key !== null);
    if (candidates.length === 0) return { forward: all, suppressed: [] };

    try {
      const notBefore = new Date(this.now().getTime() - this.windowMs);
      const markers = await this.repo.findActive([...new Set(candidates.map((c) => c.key))], notBefore);
      if (markers.length === 0) return { forward: all, suppressed: [] };
      const byPhone = new Map(markers.map((m) => [m.phoneKey, m]));

      const suppressed: SuppressedReply[] = [];
      for (const c of candidates) {
        const marker = byPhone.get(c.key);
        if (!marker) continue;
        suppressed.push({ message: c.message, marker });
        this.logger.log(
          `Reply from ${maskPhoneForLog(`+${c.key}`)} suppressed: notification from "${marker.source}" ` +
            `sent ${Math.round((this.now().getTime() - marker.sentAt.getTime()) / 60_000)} min ago`,
        );
        await this.repo.recordReply(c.key, this.now()).catch(() => undefined);
      }
      const drop = new Set(suppressed.map((s) => s.message));
      return { forward: all.filter((m) => !drop.has(m)), suppressed };
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : "unknown";
      this.logger.warn(`Notification markers unavailable (${reason}) - routing as a normal lead message`);
      return { forward: all, suppressed: [] };
    }
  }
}
