import { describe, expect, it, vi } from "vitest";
import { NotificationMarkerController } from "./notification-marker.controller";

const SECRET = "notification-secret-0123456789";
const config = (...args: [] | [string | undefined]) => ({ env: { NOTIFICATION_API_SECRET: args.length === 0 ? SECRET : args[0] } }) as never;
const routing = (impl: (i: unknown) => Promise<unknown> = async () => ({ expiresAt: new Date("2026-10-21T15:00:00Z") })) =>
  ({ register: vi.fn(impl) }) as never;

describe("NotificationMarkerController", () => {
  it("registra con el secreto correcto y devuelve cuando vence la marca", async () => {
    const r = routing();
    const c = new NotificationMarkerController(config(), r);
    await expect(c.register({ phone: "+584121234567", messageId: "w-1" }, `Bearer ${SECRET}`)).resolves.toEqual({
      registered: true, expiresAt: "2026-10-21T15:00:00.000Z",
    });
    expect((r as unknown as { register: ReturnType<typeof vi.fn> }).register).toHaveBeenCalledWith({
      phone: "+584121234567", source: "appsb", messageId: "w-1",
    });
  });

  it("falla cerrado: sin secreto configurado, sin cabecera o con secreto erroneo", async () => {
    await expect(new NotificationMarkerController(config(undefined), routing()).register({ phone: "+584121234567" }, `Bearer ${SECRET}`))
      .rejects.toThrow("Invalid notification authorization");
    const c = new NotificationMarkerController(config(), routing());
    await expect(c.register({ phone: "+584121234567" }, undefined)).rejects.toThrow("Invalid notification authorization");
    await expect(c.register({ phone: "+584121234567" }, "Bearer otro-secreto-distinto")).rejects.toThrow("Invalid notification authorization");
  });

  it("no acepta el secreto del bot ni campos desconocidos", async () => {
    const c = new NotificationMarkerController(config(), routing());
    await expect(c.register({ phone: "+584121234567", extra: 1 }, `Bearer ${SECRET}`)).rejects.toThrow("Invalid notification payload");
    await expect(c.register({}, `Bearer ${SECRET}`)).rejects.toThrow("Invalid notification payload");
  });

  it("rechaza un telefono invalido y avisa si la base no responde", async () => {
    await expect(new NotificationMarkerController(config(), routing(async () => null)).register({ phone: "abcdefgh" }, `Bearer ${SECRET}`))
      .rejects.toThrow("Invalid phone number");
    await expect(new NotificationMarkerController(config(), routing(async () => { throw new Error("db"); })).register({ phone: "+584121234567" }, `Bearer ${SECRET}`))
      .rejects.toThrow("Notification registry unavailable");
  });
});
