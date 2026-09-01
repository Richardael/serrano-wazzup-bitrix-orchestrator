import { WazzupIngestController } from "./wazzup-ingest.controller";

describe("WazzupIngestController", () => {
  const config = {
    env: { WAZZUP_WEBHOOK_BEARER_TOKEN: "webhook-secret-value" },
  };
  const inbound = {
    messageId: "inbound-1",
    channelId: "channel-1",
    chatId: "584121234567",
    status: "inbound",
    text: "Hola",
  };

  it("relays inbound raw messages without changing local handling", async () => {
    const handle = vi.fn().mockResolvedValue({ status: "processed" });
    const relayInbound = vi.fn().mockResolvedValue(undefined);
    const controller = new WazzupIngestController({ handle } as never, {
      relayInbound,
    } as never, config as never);

    await expect(controller.ingest({ messages: [inbound] }, "Bearer webhook-secret-value")).resolves.toEqual({
      status: "processed",
    });
    expect(handle).toHaveBeenCalledTimes(1);
    expect(relayInbound).toHaveBeenCalledWith({ messages: [inbound] });
  });

  it("never relays outbound or echo messages", async () => {
    const handle = vi.fn();
    const relayInbound = vi.fn().mockResolvedValue(undefined);
    const controller = new WazzupIngestController({ handle } as never, {
      relayInbound,
    } as never, config as never);

    await controller.ingest({
      messages: [
        { ...inbound, messageId: "outbound-1", status: "outbound" },
        { ...inbound, messageId: "echo-1", isEcho: true },
      ],
    }, "Bearer webhook-secret-value");

    expect(relayInbound).toHaveBeenCalledWith({
      messages: [
        { ...inbound, messageId: "outbound-1", status: "outbound" },
        { ...inbound, messageId: "echo-1", isEcho: true },
      ],
    });
    expect(handle).not.toHaveBeenCalled();
  });

  it("rejects native payloads without the bearer token", async () => {
    const controller = new WazzupIngestController({ handle: vi.fn() } as never, {
      relayInbound: vi.fn(),
    } as never, config as never);

    await expect(controller.ingest({ messages: [inbound] })).rejects.toThrow(
      "Invalid bearer token",
    );
  });

  it("accepts Wazzup's configured query token when no authorization header is sent", async () => {
    const handle = vi.fn().mockResolvedValue({ status: "processed" });
    const controller = new WazzupIngestController({ handle } as never, {
      relayInbound: vi.fn().mockResolvedValue(undefined),
    } as never, config as never);

    await expect(controller.ingest({ messages: [inbound] }, undefined, "webhook-secret-value"))
      .resolves.toEqual({ status: "processed" });
  });
});
