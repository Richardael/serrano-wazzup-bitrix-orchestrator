import { describe, expect, it, vi } from "vitest";
import {
  NotificationRoutingService,
  isCustomerMessage,
  notificationPhoneKey,
} from "./notification-routing.service";
import type { NotificationMarker, NotificationMarkerRepository } from "../ports/notification-marker.port";

const NOW = new Date("2026-10-20T15:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

class FakeRepo implements NotificationMarkerRepository {
  markers = new Map<string, NotificationMarker>();
  replies: string[] = [];
  fail = false;
  async register(i: { phoneKey: string; source: string; messageId: string | null; sentAt: Date }) {
    if (this.fail) throw new Error("db down");
    this.markers.set(i.phoneKey, { phoneKey: i.phoneKey, sentAt: i.sentAt, source: i.source, messageId: i.messageId });
  }
  async findActive(keys: readonly string[], notBefore: Date) {
    if (this.fail) throw new Error("db down");
    return [...this.markers.values()].filter((m) => keys.includes(m.phoneKey) && m.sentAt >= notBefore);
  }
  async recordReply(key: string) { this.replies.push(key); }
}

function service(over: Record<string, unknown> = {}, repo = new FakeRepo()) {
  const config = { env: { NOTIFICATION_ROUTING_ENABLED: true, NOTIFICATION_REPLY_WINDOW_HOURS: 24, ...over } };
  return { svc: new NotificationRoutingService(config as never, repo, () => NOW), repo };
}

const reply = (chatId: string, extra: Record<string, unknown> = {}) => ({
  messageId: `m-${chatId}-${Math.random()}`, channelId: "ch", chatId, status: "inbound", isEcho: false, text: "gracias", ...extra,
});

describe("notificationPhoneKey", () => {
  it("unifica las formas habituales de un mismo telefono venezolano", () => {
    const canonical = "584121234567";
    for (const raw of ["584121234567", "+584121234567", "+58 412 123 4567", "04121234567", "0412-123-4567"]) {
      expect(notificationPhoneKey(raw), raw).toBe(canonical);
    }
  });
  it("acepta otros paises y rechaza basura", () => {
    expect(notificationPhoneKey("+15551234567")).toBe("15551234567");
    for (const bad of ["", "abc", "123", null, undefined, {}]) expect(notificationPhoneKey(bad as never)).toBeNull();
  });
});

describe("isCustomerMessage", () => {
  it("solo cuenta lo que escribe el cliente", () => {
    expect(isCustomerMessage(reply("1"))).toBe(true);
    expect(isCustomerMessage({ status: "inbound" })).toBe(true);
    expect(isCustomerMessage({ status: "outbound" })).toBe(false);
    expect(isCustomerMessage({ status: "outgoing" })).toBe(false);
    expect(isCustomerMessage({ status: "sent" })).toBe(false);
    expect(isCustomerMessage({ status: "delivered" })).toBe(false);
    expect(isCustomerMessage({ status: "inbound", isEcho: true })).toBe(false);
  });
});

describe("NotificationRoutingService", () => {
  it("la respuesta de un cliente notificado hace menos de 24 h NO entra al flujo de leads", async () => {
    const { svc, repo } = service();
    await svc.register({ phone: "+584121234567", source: "appsb", messageId: "w-1" });
    const msg = reply("584121234567");
    const r = await svc.partition([msg]);
    expect(r.forward).toEqual([]);
    expect(r.suppressed).toHaveLength(1);
    expect(r.suppressed[0]!.marker.source).toBe("appsb");
    expect(repo.replies).toEqual(["584121234567"]);
  });

  it("sin notificacion previa el mensaje sigue como siempre", async () => {
    const { svc } = service();
    const msg = reply("584121234567");
    const r = await svc.partition([msg]);
    expect(r.forward).toEqual([msg]);
    expect(r.suppressed).toEqual([]);
  });

  it("pasada la ventana (24 h) vuelve al flujo de leads", async () => {
    const { svc, repo } = service();
    await repo.register({ phoneKey: "584121234567", source: "appsb", messageId: null, sentAt: hoursAgo(24.1) });
    expect((await svc.partition([reply("584121234567")])).suppressed).toEqual([]);
    await repo.register({ phoneKey: "584121234567", source: "appsb", messageId: null, sentAt: hoursAgo(23.9) });
    expect((await svc.partition([reply("584121234567")])).suppressed).toHaveLength(1);
  });

  it("la ventana es configurable", async () => {
    const { svc, repo } = service({ NOTIFICATION_REPLY_WINDOW_HOURS: 2 });
    await repo.register({ phoneKey: "584121234567", source: "appsb", messageId: null, sentAt: hoursAgo(3) });
    expect((await svc.partition([reply("584121234567")])).suppressed).toEqual([]);
  });

  it("solo se suprime al telefono notificado; los demas mensajes del mismo webhook siguen", async () => {
    const { svc } = service();
    await svc.register({ phone: "584121234567", source: "appsb" });
    const notified = reply("584121234567");
    const lead = reply("584149998888");
    const r = await svc.partition([notified, lead]);
    expect(r.forward).toEqual([lead]);
    expect(r.suppressed.map((s) => s.message)).toEqual([notified]);
  });

  it("los ecos y los mensajes salientes no cuentan como respuesta ni se tocan", async () => {
    const { svc, repo } = service();
    await svc.register({ phone: "584121234567", source: "appsb" });
    const echo = reply("584121234567", { isEcho: true });
    const out = reply("584121234567", { status: "outbound" });
    const r = await svc.partition([echo, out]);
    expect(r.forward).toEqual([echo, out]);
    expect(r.suppressed).toEqual([]);
    expect(repo.replies).toEqual([]);
  });

  it("el interruptor lo apaga todo", async () => {
    const { svc } = service({ NOTIFICATION_ROUTING_ENABLED: false });
    await svc.register({ phone: "584121234567", source: "appsb" });
    const msg = reply("584121234567");
    expect((await svc.partition([msg])).forward).toEqual([msg]);
  });

  it("falla ABIERTO: si la base no responde, el mensaje del cliente no se pierde", async () => {
    const { svc, repo } = service();
    await svc.register({ phone: "584121234567", source: "appsb" });
    repo.fail = true;
    const msg = reply("584121234567");
    const r = await svc.partition([msg]);
    expect(r.forward).toEqual([msg]);
    expect(r.suppressed).toEqual([]);
  });

  it("una nueva notificacion renueva la ventana", async () => {
    const { svc, repo } = service();
    await repo.register({ phoneKey: "584121234567", source: "appsb", messageId: null, sentAt: hoursAgo(30) });
    expect((await svc.partition([reply("584121234567")])).suppressed).toEqual([]);
    await svc.register({ phone: "584121234567", source: "appsb" });
    expect((await svc.partition([reply("584121234567")])).suppressed).toHaveLength(1);
  });

  it("register rechaza lo que no es un telefono y devuelve cuando vence la marca", async () => {
    const { svc } = service();
    expect(await svc.register({ phone: "no-es-telefono", source: "appsb" })).toBeNull();
    const ok = await svc.register({ phone: "584121234567", source: "appsb" });
    expect(ok!.expiresAt.toISOString()).toBe(new Date(NOW.getTime() + 24 * 3_600_000).toISOString());
  });

  it("no consulta la base si no hay mensajes de clientes", async () => {
    const repo = new FakeRepo();
    const spy = vi.spyOn(repo, "findActive");
    const { svc } = service({}, repo);
    await svc.partition([reply("584121234567", { isEcho: true })]);
    expect(spy).not.toHaveBeenCalled();
  });
});
