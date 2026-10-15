import { Logger } from "@nestjs/common";
import { LeadRecord } from "../../domain/leads/lead";
import { Bitrix24Port } from "../ports/bitrix24.port";

/**
 * La integración nativa de Wazzup con Bitrix crea su propio lead (fuente
 * `WZ<channelId>`, creador el usuario que conectó la integración) en el mismo
 * minuto en que el orquestador crea el suyo, y no se puede apagar desde la
 * cuenta de Wazzup. El lead del orquestador es el que sigue el agente, así que
 * el de Wazzup es el redundante.
 */
const WAZZUP_NATIVE_SOURCE_PREFIX = "WZ";
const INACTIVE_STATUSES = new Set(["CONVERTED", "JUNK"]);

// Valores de las listas del portal (crm.lead.fields).
const RESULTADO_CONTACTO_DUPLICADO = 406;
const MOTIVO_DESCARTE_DUPLICADO = 428;

const SWEEP_DELAYS_MS = [20_000, 90_000];

export function isWazzupNativeLead(lead: LeadRecord): boolean {
  return lead.sourceId.startsWith(WAZZUP_NATIVE_SOURCE_PREFIX);
}

/**
 * Leads de la integración nativa de Wazzup que sobran: están activos, nadie los
 * ha movido de "Nuevos Leads" y existe otro lead activo del mismo teléfono que
 * no es de Wazzup. Si el de Wazzup es el único, no se toca: es el lead del
 * cliente.
 */
export function pickWazzupNativeDuplicates(activeLeads: readonly LeadRecord[]): LeadRecord[] {
  const hayOtroLead = activeLeads.some((l) => !isWazzupNativeLead(l));
  if (!hayOtroLead) return [];
  return activeLeads.filter(
    (l) => isWazzupNativeLead(l) && l.statusId === "NEW" && !INACTIVE_STATUSES.has(l.statusId),
  );
}

/** Cierra los leads sobrantes como duplicados. Devuelve los IDs que se cerraron. */
export async function closeWazzupNativeDuplicates(
  bitrix: Bitrix24Port,
  duplicates: readonly LeadRecord[],
  keep: readonly LeadRecord[],
  logger: Logger,
): Promise<Set<string>> {
  const keepIds = keep.filter((l) => !isWazzupNativeLead(l)).map((l) => l.id);
  const closed = new Set<string>();
  for (const dup of duplicates) {
    try {
      await bitrix.updateLead(dup.id, {
        statusId: "JUNK",
        ufFields: {
          UF_CRM_CONTACT_RESULT_2026: RESULTADO_CONTACTO_DUPLICADO,
          UF_CRM_DISCARD_REASON_2026: MOTIVO_DESCARTE_DUPLICADO,
        },
        comments:
          `Duplicado del lead ${keepIds.join(", ")}: lo creó la integración nativa de Wazzup ` +
          `junto al del orquestador. Cerrado automáticamente.`,
      });
      closed.add(dup.id);
      logger.log(`Lead ${dup.id} (Wazzup nativo) cerrado como duplicado de ${keepIds.join(", ")}`);
    } catch (err: unknown) {
      logger.error(`No se pudo cerrar el lead duplicado ${dup.id}: ${err}`);
    }
  }
  return closed;
}

/**
 * Wazzup puede crear su lead unos segundos DESPUÉS del orquestador, cuando ya
 * se buscó y no había nada. Se vuelve a mirar un poco más tarde para cerrarlo.
 * Los temporizadores no sobreviven a un reinicio; si pasa, el siguiente mensaje
 * del cliente repite la limpieza porque entra por el mismo camino.
 */
export function scheduleWazzupDuplicateSweep(
  bitrix: Bitrix24Port,
  normalizedPhone: string,
  createdLeadId: string,
  logger: Logger,
): void {
  for (const delay of SWEEP_DELAYS_MS) {
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const leads = await bitrix.findLeadsByPhone(normalizedPhone);
          const active = leads.filter((l) => !INACTIVE_STATUSES.has(l.statusId));
          if (!active.some((l) => l.id === createdLeadId)) return;
          const dups = pickWazzupNativeDuplicates(active);
          if (dups.length > 0) await closeWazzupNativeDuplicates(bitrix, dups, active, logger);
        } catch (err: unknown) {
          logger.error(`Revisión de duplicados de Wazzup falló: ${err}`);
        }
      })();
    }, delay);
    timer.unref();
  }
}
