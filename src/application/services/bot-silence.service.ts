import { Logger } from "@nestjs/common";
import { AppConfig } from "../../infrastructure/config/app.config";
import { normalizePhoneNumber } from "../../infrastructure/config/phone-normalizer";
import { Bitrix24Port } from "../ports/bitrix24.port";
import { parseAlertStatuses } from "./client-reply-alert.service";

/**
 * Decide si el bot debe callarse ante el mensaje de un cliente.
 *
 * El bot solo sabe que un lead pasó a ventas cuando el traspaso lo hizo él. Si
 * lo movió una vendedora o el reparto automático de Viewer, el bot ve un chat
 * nuevo, abre su menú y le contesta a un cliente que ya está hablando con una
 * persona. Por eso se mira la etapa del lead en Bitrix antes de reenviarle el
 * mensaje: de "Hablar con asesor" en adelante (`BOT_SILENT_STATUSES`) el
 * cliente es de la vendedora.
 *
 * Si Bitrix no responde, el bot sigue contestando como siempre: es preferible a
 * dejar sin respuesta a un cliente nuevo.
 */
export class BotSilenceService {
  private readonly logger = new Logger(BotSilenceService.name);

  constructor(
    private readonly bitrix: Bitrix24Port,
    private readonly config: AppConfig,
  ) {}

  private get etapas(): Set<string> {
    return parseAlertStatuses(this.config.env.BOT_SILENT_STATUSES);
  }

  /** El lead que ya atiende una vendedora para este teléfono, o null. */
  async leadAtendido(rawPhone: string): Promise<string | null> {
    const digits = rawPhone.replace(/\D/g, "");
    if (!digits) return null;
    const phone = normalizePhoneNumber(`+${digits}`);
    if (!phone) return null;
    try {
      const leads = await this.bitrix.findLeadsByPhone(phone);
      const etapas = this.etapas;
      return leads.find((l) => etapas.has(l.statusId))?.id ?? null;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`No se pudo consultar la etapa del lead; el bot contesta: ${msg}`);
      return null;
    }
  }
}
