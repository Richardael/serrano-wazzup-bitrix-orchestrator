import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CLIENT_REPLY_ALERT_TITLE,
  ClientReplyAlertService,
  bitrixDatetime,
} from "../../src/application/services/client-reply-alert.service";
import {
  AddLeadTodoInput,
  Bitrix24Port,
  LeadActivity,
} from "../../src/application/ports/bitrix24.port";
import { LeadRecord } from "../../src/domain/leads/lead";
import { AppConfig } from "../../src/infrastructure/config/app.config";
import { IncomingMessageHandler } from "../../src/application/services/incoming-message.handler";
import { Bitrix24HttpAdapter } from "../../src/infrastructure/bitrix24/bitrix24-http.adapter";
import { NormalizedIncomingMessage } from "../../src/domain/messages/normalized-message";

const lead = (over: Partial<LeadRecord> = {}): LeadRecord => ({
  id: "9698",
  title: "WhatsApp / Ana",
  statusId: "IN_PROCESS",
  assignedById: "268",
  sourceId: "WHATSAPP",
  phone: "+584120000000",
  createdAt: "2026-10-20T10:00:00+00:00",
  ...over,
});

const config = (env: Partial<AppConfig["env"]> = {}): AppConfig =>
  ({ env: { CLIENT_REPLY_ALERT_ENABLED: true, ...env } }) as unknown as AppConfig;

function fakeBitrix(open: LeadActivity[] = []) {
  const created: AddLeadTodoInput[] = [];
  const port = {
    listOpenLeadActivities: vi.fn(async () => open),
    addLeadTodo: vi.fn(async (input: AddLeadTodoInput) => {
      created.push(input);
      return String(100 + created.length);
    }),
  } as unknown as Bitrix24Port;
  return { port, created };
}

const AHORA = new Date("2026-10-27T15:04:05.678Z");

describe("ClientReplyAlertService", () => {
  it("crea un to-do vencido ya, asignado a la responsable del lead", async () => {
    const { port, created } = fakeBitrix();
    const svc = new ClientReplyAlertService(port, config(), () => AHORA);

    expect(await svc.notify(lead())).toBe("created");
    expect(created).toEqual([
      {
        leadId: "9698",
        title: CLIENT_REPLY_ALERT_TITLE,
        description: expect.stringContaining("Wazzup"),
        deadline: "2026-10-27T15:04:05+00:00",
        responsibleId: "268",
      },
    ]);
  });

  it("no crea otra mientras haya una alerta abierta", async () => {
    const { port, created } = fakeBitrix([{ id: "55", subject: CLIENT_REPLY_ALERT_TITLE }]);
    const svc = new ClientReplyAlertService(port, config(), () => AHORA);

    expect(await svc.notify(lead())).toBe("already_open");
    expect(created).toHaveLength(0);
  });

  it("otras actividades abiertas del lead no la bloquean", async () => {
    const { port, created } = fakeBitrix([{ id: "56", subject: "Llamar mañana" }]);
    const svc = new ClientReplyAlertService(port, config(), () => AHORA);

    expect(await svc.notify(lead())).toBe("created");
    expect(created).toHaveLength(1);
  });

  it("dos mensajes simultáneos del mismo cliente dejan una sola alerta", async () => {
    const { port, created } = fakeBitrix();
    const svc = new ClientReplyAlertService(port, config(), () => AHORA);

    const resultados = await Promise.all([svc.notify(lead()), svc.notify(lead())]);
    expect(resultados.sort()).toEqual(["created", "in_flight"]);
    expect(created).toHaveLength(1);
  });

  it("apagada por configuración no toca Bitrix", async () => {
    const { port } = fakeBitrix();
    const svc = new ClientReplyAlertService(port, config({ CLIENT_REPLY_ALERT_ENABLED: false }));

    expect(await svc.notify(lead())).toBe("disabled");
    expect(port.listOpenLeadActivities).not.toHaveBeenCalled();
  });

  it("lead sin responsable: usa la responsable por defecto del portal", async () => {
    const { port, created } = fakeBitrix();
    const svc = new ClientReplyAlertService(
      port,
      config({ BITRIX24_DEFAULT_RESPONSIBLE_ID: 1 }),
      () => AHORA,
    );

    await svc.notify(lead({ assignedById: "0" }));
    expect(created[0]!.responsibleId).toBe("1");
  });

  it("lead sin responsable ni valor por defecto: no envía responsibleId", async () => {
    const { port, created } = fakeBitrix();
    const svc = new ClientReplyAlertService(port, config(), () => AHORA);

    await svc.notify(lead({ assignedById: "" }));
    expect(created[0]).not.toHaveProperty("responsibleId");
  });

  it("si Bitrix falla, devuelve error sin lanzar y libera el lead", async () => {
    const { port } = fakeBitrix();
    (port.listOpenLeadActivities as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("timeout"),
    );
    const svc = new ClientReplyAlertService(port, config(), () => AHORA);

    expect(await svc.notify(lead())).toBe("error");
    expect(await svc.notify(lead())).toBe("created");
  });

  it("formatea la fecha como la acepta Bitrix", () => {
    expect(bitrixDatetime(new Date("2026-01-02T03:04:05.000Z"))).toBe("2026-01-02T03:04:05+00:00");
  });
});

describe("IncomingMessageHandler → alerta de respuesta", () => {
  const mensaje: NormalizedIncomingMessage = {
    providerEventId: "e1",
    providerMessageId: "m1",
    channelId: "f207",
    direction: "inbound",
    messageType: "text",
    occurredAt: "2026-10-27T15:00:00Z",
    contact: { externalId: null, displayName: "Ana", rawPhone: "+584120000000", normalizedPhone: "+584120000000" },
    content: { hasText: true, textHash: "x", hasAttachments: false },
    rawMetadata: null,
  };

  function handlerCon(leads: LeadRecord[]) {
    const notify = vi.fn(async () => "created" as const);
    const bitrix = {
      upsertContact: vi.fn(async () => "c1"),
      findLeadsByPhone: vi.fn(async () => leads),
      updateLead: vi.fn(async () => undefined),
      createLead: vi.fn(async () => "nuevo"),
    } as unknown as Bitrix24Port;
    const cfg = { env: { WAZZUP_NATIVE_DEDUP_ENABLED: false } } as unknown as AppConfig;
    const handler = new IncomingMessageHandler(
      cfg, {} as never, {} as never, bitrix, {} as never, {} as never, {} as never, {} as never,
      { notify } as unknown as ClientReplyAlertService,
    );
    const handleDirect = (handler as unknown as {
      handleDirect: (m: NormalizedIncomingMessage, p: string) => Promise<{ status: string }>;
    }).handleDirect.bind(handler);
    return { notify, handleDirect };
  }

  it("avisa cuando el cliente escribe en su lead activo", async () => {
    const activo = lead();
    const { notify, handleDirect } = handlerCon([activo]);
    expect((await handleDirect(mensaje, "***")).status).toBe("lead_reused");
    expect(notify).toHaveBeenCalledWith(activo);
  });

  it("no avisa cuando el mensaje crea un lead nuevo (ya aparece como nuevo)", async () => {
    const { notify, handleDirect } = handlerCon([]);
    expect((await handleDirect(mensaje, "***")).status).toBe("lead_created");
    expect(notify).not.toHaveBeenCalled();
  });

  it("no avisa en leads cerrados", async () => {
    const { notify, handleDirect } = handlerCon([lead({ statusId: "JUNK" })]);
    expect((await handleDirect(mensaje, "***")).status).toBe("lead_created");
    expect(notify).not.toHaveBeenCalled();
  });
});

describe("Bitrix24HttpAdapter: actividades del lead", () => {
  afterEach(() => vi.unstubAllGlobals());

  function adapterConRespuesta(result: unknown) {
    const llamadas: { url: string; body: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: { body: string }) => {
        llamadas.push({ url, body: decodeURIComponent(init.body) });
        return { ok: true, status: 200, headers: new Headers(), json: async () => ({ result }) };
      }),
    );
    const adapter = new Bitrix24HttpAdapter({
      env: { BITRIX24_WEBHOOK_BASE_URL: "https://portal.test/rest/1/abc/" },
    } as unknown as AppConfig);
    return { adapter, llamadas };
  }

  it("lista solo las actividades sin completar del lead", async () => {
    const { adapter, llamadas } = adapterConRespuesta([{ ID: "7", SUBJECT: "Hola" }]);
    expect(await adapter.listOpenLeadActivities("9698")).toEqual([{ id: "7", subject: "Hola" }]);
    expect(llamadas[0]!.url).toBe("https://portal.test/rest/1/abc/crm.activity.list.json");
    expect(llamadas[0]!.body).toContain("filter[OWNER_TYPE_ID]=1");
    expect(llamadas[0]!.body).toContain("filter[OWNER_ID]=9698");
    expect(llamadas[0]!.body).toContain("filter[COMPLETED]=N");
  });

  it("crea el to-do en el lead con crm.activity.todo.add", async () => {
    const { adapter, llamadas } = adapterConRespuesta({ id: 321 });
    const id = await adapter.addLeadTodo({
      leadId: "9698",
      title: CLIENT_REPLY_ALERT_TITLE,
      description: "d",
      deadline: "2026-10-27T15:04:05+00:00",
      responsibleId: "268",
    });
    expect(id).toBe("321");
    expect(llamadas[0]!.url).toBe("https://portal.test/rest/1/abc/crm.activity.todo.add.json");
    for (const parte of ["ownerTypeId=1", "ownerId=9698", "deadline=2026-10-27T15:04:05+00:00", "responsibleId=268"]) {
      expect(llamadas[0]!.body).toContain(parte);
    }
  });

  it("si Bitrix no devuelve id, lanza para que el servicio lo registre", async () => {
    const { adapter } = adapterConRespuesta(null);
    await expect(
      adapter.addLeadTodo({ leadId: "1", title: "t", description: "d", deadline: "x" }),
    ).rejects.toThrow(/todo add error/);
  });
});
