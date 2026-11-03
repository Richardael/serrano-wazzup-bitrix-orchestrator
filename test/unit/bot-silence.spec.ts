import { describe, expect, it, vi } from "vitest";
import { BotSilenceService } from "../../src/application/services/bot-silence.service";
import { Bitrix24Port } from "../../src/application/ports/bitrix24.port";
import { LeadRecord } from "../../src/domain/leads/lead";
import { AppConfig } from "../../src/infrastructure/config/app.config";
import { BotInboundRelayService } from "../../src/infrastructure/bot/bot-inbound-relay.service";

const lead = (statusId: string, id = "9988"): LeadRecord => ({
  id,
  title: "WhatsApp / David",
  statusId,
  assignedById: "268",
  sourceId: "WHATSAPP",
  phone: "+584143324910",
  createdAt: "2026-11-02T10:00:00+00:00",
});

const config = (env: Partial<AppConfig["env"]> = {}): AppConfig =>
  ({
    env: {
      BOT_SILENT_STATUSES: "IN_PROCESS,ON_HOLD,RESTORED,UC_G1C4G0",
      BOT_INTERNAL_BASE_URL: "http://bot-crm:3000",
      ORCHESTRATOR_SHARED_SECRET: "s",
      ...env,
    },
  }) as unknown as AppConfig;

const bitrix = (find: Bitrix24Port["findLeadsByPhone"]) =>
  ({ findLeadsByPhone: vi.fn(find) }) as unknown as Bitrix24Port;

const inbound = (chatId: string, chatType = "whatsapp") => ({
  messageId: `m-${chatId}`,
  chatId,
  chatType,
  status: "inbound",
  text: "le puedo enviar la informacion completa el miercoles",
});

describe("BotSilenceService", () => {
  it("devuelve el lead si ya está con una vendedora", async () => {
    const port = bitrix(async () => [lead("IN_PROCESS")]);
    const s = new BotSilenceService(port, config());
    expect(await s.leadAtendido("584143324910")).toBe("9988");
    expect(port.findLeadsByPhone).toHaveBeenCalledWith("+584143324910");
  });

  it("deja contestar al bot en Nuevos, intentos de contacto y sin lead", async () => {
    for (const etapa of ["NEW", "UC_CONTACT_AGENT", "ASSIGNED", "DETAILS", "JUNK", "CONVERTED"]) {
      const s = new BotSilenceService(bitrix(async () => [lead(etapa)]), config());
      expect(await s.leadAtendido("584143324910"), etapa).toBeNull();
    }
    expect(await new BotSilenceService(bitrix(async () => []), config()).leadAtendido("584143324910")).toBeNull();
  });

  it("si Bitrix falla, el bot contesta", async () => {
    const s = new BotSilenceService(bitrix(async () => { throw new Error("timeout"); }), config());
    expect(await s.leadAtendido("584143324910")).toBeNull();
  });

  it("con la variable vacía no calla nunca", async () => {
    const s = new BotSilenceService(bitrix(async () => [lead("IN_PROCESS")]), config({ BOT_SILENT_STATUSES: "" }));
    expect(await s.leadAtendido("584143324910")).toBeNull();
  });
});

describe("BotInboundRelayService con silencio", () => {
  it("no reenvía al bot el mensaje de un cliente que atiende una vendedora", async () => {
    const fetchFn = vi.fn(async () => new Response("{}", { status: 200 }));
    const silence = new BotSilenceService(
      bitrix(async (phone) => (phone === "+584143324910" ? [lead("IN_PROCESS")] : [])),
      config(),
    );
    const relay = new BotInboundRelayService(config(), silence, fetchFn as unknown as typeof fetch);

    await relay.relayInbound({ messages: [inbound("584143324910")] });
    expect(fetchFn).not.toHaveBeenCalled();

    await relay.relayInbound({ messages: [inbound("584143324910"), inbound("584121112233"), inbound("ana.ig", "instagram")] });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.messages.map((m: { chatId: string }) => m.chatId)).toEqual(["584121112233", "ana.ig"]);
  });
});
