import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CLIENT_REPLY_ALERT_TITLE,
  ClientReplyAlertService,
  NOTIFY_INTERVAL_MS,
  alertDescription,
  bitrixDatetime,
  countFromDescription,
} from "../../src/application/services/client-reply-alert.service";
import { isVendorReply } from "../../src/interfaces/webhooks/wazzup-ingest.controller";
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
  ({
    env: {
      CLIENT_REPLY_ALERT_ENABLED: true,
      CLIENT_REPLY_ALERT_STATUSES: "UC_HABLAR_ASESOR,IN_PROCESS,ON_HOLD,RESTORED,UC_G1C4G0",
      ...env,
    },
  }) as unknown as AppConfig;

/** Bitrix en memoria: las alertas que se crean quedan abiertas para el mensaje siguiente. */
function fakeBitrix(open: LeadActivity[] = [], leads: LeadRecord[] = []) {
  const abiertas = [...open];
  const created: AddLeadTodoInput[] = [];
  const updated: { id: string; input: AddLeadTodoInput }[] = [];
  const completed: string[] = [];
  const notified: { userId: string; message: string }[] = [];
  const port = {
    findLeadsByPhone: vi.fn(async () => leads),
    listOpenLeadActivities: vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 1));
      return abiertas.map((a) => ({ ...a }));
    }),
    addLeadTodo: vi.fn(async (input: AddLeadTodoInput) => {
      created.push(input);
      const id = String(100 + created.length);
      abiertas.push({ id, subject: input.title, description: input.description });
      return id;
    }),
    updateLeadTodo: vi.fn(async (id: string, input: AddLeadTodoInput) => {
      updated.push({ id, input });
      const a = abiertas.find((x) => x.id === id)!;
      abiertas[abiertas.indexOf(a)] = { id, subject: input.title, description: input.description };
    }),
    completeActivity: vi.fn(async (id: string) => {
      completed.push(id);
      abiertas.splice(abiertas.findIndex((x) => x.id === id), 1);
    }),
    notifyUser: vi.fn(async (userId: string, message: string) => {
      notified.push({ userId, message });
    }),
  } as unknown as Bitrix24Port;
  return { port, created, updated, completed, notified };
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
        description: expect.stringMatching(/^1 mensaje nuevo del cliente, el último a las 11:04/),
        deadline: "2026-10-27T15:04:05+00:00",
        responsibleId: "268",
      },
    ]);
  });

  it("con una alerta abierta no crea otra: la actualiza con el contador y la hora", async () => {
    const abierta = { id: "55", subject: CLIENT_REPLY_ALERT_TITLE, description: alertDescription(2, AHORA) };
    const { port, created, updated } = fakeBitrix([abierta]);
    const despues = new Date(AHORA.getTime() + 20 * 60_000);
    const svc = new ClientReplyAlertService(port, config(), () => despues);

    expect(await svc.notify(lead())).toBe("updated");
    expect(created).toHaveLength(0);
    expect(updated).toEqual([
      {
        id: "55",
        input: {
          leadId: "9698",
          title: CLIENT_REPLY_ALERT_TITLE,
          description: expect.stringMatching(/^3 mensajes nuevos del cliente, el último a las 11:24/),
          deadline: "2026-10-27T15:24:05+00:00",
          responsibleId: "268",
        },
      },
    ]);
  });

  it("una alerta de antes del contador cuenta como un mensaje", async () => {
    const vieja = { id: "55", subject: CLIENT_REPLY_ALERT_TITLE, description: "El cliente escribió por WhatsApp." };
    const { port, updated } = fakeBitrix([vieja]);
    await new ClientReplyAlertService(port, config(), () => AHORA).notify(lead());
    expect(updated[0]!.input.description).toMatch(/^2 mensajes nuevos/);
  });

  it("lee el contador de la descripción", () => {
    expect(countFromDescription(alertDescription(1, AHORA))).toBe(1);
    expect(countFromDescription(alertDescription(7, AHORA))).toBe(7);
    expect(countFromDescription("")).toBe(1);
  });

  it("notifica a la responsable, como mucho una vez cada intervalo por lead", async () => {
    const { port, notified } = fakeBitrix();
    let ahora = AHORA;
    const svc = new ClientReplyAlertService(port, config(), () => ahora);

    await svc.notify(lead());
    ahora = new Date(AHORA.getTime() + 60_000);
    await svc.notify(lead());
    expect(notified).toEqual([
      {
        userId: "268",
        message: "El cliente de [url=/crm/lead/details/9698/]WhatsApp / Ana[/url] te escribió por WhatsApp (1 mensaje nuevo sin responder).",
      },
    ]);

    ahora = new Date(AHORA.getTime() + NOTIFY_INTERVAL_MS + 1);
    await svc.notify(lead());
    expect(notified).toHaveLength(2);
    expect(notified[1]!.message).toContain("(3 mensajes nuevos sin responder)");
  });

  it("si la notificación falla, la alerta queda igual", async () => {
    const { port, created } = fakeBitrix();
    (port.notifyUser as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("sin scope im"));
    const svc = new ClientReplyAlertService(port, config(), () => AHORA);

    expect(await svc.notify(lead())).toBe("created");
    expect(created).toHaveLength(1);
  });

  it("otras actividades abiertas del lead no la bloquean", async () => {
    const { port, created } = fakeBitrix([{ id: "56", subject: "Llamar mañana" }]);
    const svc = new ClientReplyAlertService(port, config(), () => AHORA);

    expect(await svc.notify(lead())).toBe("created");
    expect(created).toHaveLength(1);
  });

  it("una ráfaga de mensajes deja una sola alerta y los cuenta todos", async () => {
    const { port, created, updated } = fakeBitrix();
    const svc = new ClientReplyAlertService(port, config(), () => AHORA);

    const resultados = await Promise.all([svc.notify(lead()), svc.notify(lead()), svc.notify(lead())]);
    expect(resultados).toEqual(["created", "updated", "updated"]);
    expect(created).toHaveLength(1);
    expect(updated.at(-1)!.input.description).toMatch(/^3 mensajes nuevos/);
  });

  it("cuando la vendedora contesta, cierra las alertas abiertas del cliente", async () => {
    const abierta = { id: "55", subject: CLIENT_REPLY_ALERT_TITLE, description: alertDescription(2, AHORA) };
    const otra = { id: "56", subject: "Llamar mañana", description: "" };
    const { port, completed } = fakeBitrix([abierta, otra], [lead(), lead({ id: "1", statusId: "JUNK" })]);
    const svc = new ClientReplyAlertService(port, config(), () => AHORA);

    expect(await svc.resolve("584120000000@c.us")).toBe(1);
    expect(completed).toEqual(["55"]);
    expect(port.findLeadsByPhone).toHaveBeenCalledWith("+584120000000");
  });

  it("tras contestar, el siguiente mensaje del cliente crea una alerta nueva y vuelve a notificar", async () => {
    const { port, created, notified } = fakeBitrix([], [lead()]);
    const svc = new ClientReplyAlertService(port, config(), () => AHORA);

    await svc.notify(lead());
    await svc.resolve("584120000000");
    expect(await svc.notify(lead())).toBe("created");
    expect(created).toHaveLength(2);
    expect(created[1]!.description).toMatch(/^1 mensaje nuevo/);
    expect(notified).toHaveLength(2);
  });

  it("cerrar alertas no falla si Bitrix no responde", async () => {
    const { port } = fakeBitrix();
    (port.findLeadsByPhone as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("timeout"));
    expect(await new ClientReplyAlertService(port, config()).resolve("584120000000")).toBe(0);
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

  it("avisa desde Hablar con asesor en adelante y en la campaña de reactivación", async () => {
    for (const statusId of ["UC_HABLAR_ASESOR", "IN_PROCESS", "ON_HOLD", "RESTORED", "UC_G1C4G0"]) {
      const { port } = fakeBitrix();
      const svc = new ClientReplyAlertService(port, config(), () => AHORA);
      expect(await svc.notify(lead({ statusId })), statusId).toBe("created");
    }
  });

  it("no avisa en Nuevos ni en los intentos de contacto", async () => {
    for (const statusId of ["NEW", "ASSIGNED", "CANNOT_CONTACT", "DETAILS"]) {
      const { port } = fakeBitrix();
      const svc = new ClientReplyAlertService(port, config(), () => AHORA);
      expect(await svc.notify(lead({ statusId })), statusId).toBe("stage_not_alerted");
      expect(port.listOpenLeadActivities).not.toHaveBeenCalled();
    }
  });

  it("las etapas se configuran con la variable", async () => {
    const reactivacion = lead({ statusId: "UC_G1C4G0" });
    const sinReactivacion = new ClientReplyAlertService(
      fakeBitrix().port,
      config({ CLIENT_REPLY_ALERT_STATUSES: "IN_PROCESS, ON_HOLD" }),
      () => AHORA,
    );
    expect(await sinReactivacion.notify(reactivacion)).toBe("stage_not_alerted");
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
    const { adapter, llamadas } = adapterConRespuesta([{ ID: "7", SUBJECT: "Hola", DESCRIPTION: "2 mensajes" }]);
    expect(await adapter.listOpenLeadActivities("9698")).toEqual([{ id: "7", subject: "Hola", description: "2 mensajes" }]);
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

describe("Bitrix24HttpAdapter: actualizar, completar y notificar", () => {
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

  it("actualiza el to-do mandando todos los campos (Bitrix borra los que faltan)", async () => {
    const { adapter, llamadas } = adapterConRespuesta({ id: 55 });
    await adapter.updateLeadTodo("55", {
      leadId: "9698", title: CLIENT_REPLY_ALERT_TITLE, description: "2 mensajes", deadline: "2026-10-27T15:04:05+00:00", responsibleId: "268",
    });
    expect(llamadas[0]!.url).toBe("https://portal.test/rest/1/abc/crm.activity.todo.update.json");
    for (const parte of ["id=55", "ownerTypeId=1", "ownerId=9698", `title=${CLIENT_REPLY_ALERT_TITLE}`, "description=2 mensajes", "deadline=", "responsibleId=268"]) {
      expect(llamadas[0]!.body).toContain(parte);
    }
  });

  it("completa la actividad con crm.activity.update", async () => {
    const { adapter, llamadas } = adapterConRespuesta(true);
    await adapter.completeActivity("55");
    expect(llamadas[0]!.url).toBe("https://portal.test/rest/1/abc/crm.activity.update.json");
    expect(llamadas[0]!.body).toContain("fields[COMPLETED]=Y");
  });

  it("notifica con im.notify.system.add y lanza si Bitrix lo rechaza", async () => {
    const { adapter, llamadas } = adapterConRespuesta(1);
    await adapter.notifyUser("268", "hola");
    expect(llamadas[0]!.url).toBe("https://portal.test/rest/1/abc/im.notify.system.add.json");
    expect(llamadas[0]!.body).toContain("USER_ID=268");

    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false, status: 401, headers: new Headers(), json: async () => ({ error: "insufficient_scope" }),
    })));
    await expect(adapter.notifyUser("268", "hola")).rejects.toThrow(/insufficient_scope/);
  });
});

describe("isVendorReply", () => {
  it("solo los salientes escritos por una persona desde Wazzup", () => {
    expect(isVendorReply({ isEcho: true, sentFromApp: true })).toBe(true);
    expect(isVendorReply({ isEcho: true, authorId: "268", authorName: "Sabrina" })).toBe(true);
    expect(isVendorReply({ isEcho: true, status: "sent" })).toBe(false); // bot o plantilla por API
    expect(isVendorReply({ isEcho: true, authorId: "" })).toBe(false);
    expect(isVendorReply({ isEcho: false, sentFromApp: true, status: "inbound" })).toBe(false);
  });
});
