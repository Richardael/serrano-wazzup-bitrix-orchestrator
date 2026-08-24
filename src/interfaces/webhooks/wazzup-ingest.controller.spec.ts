import { WazzupIngestController } from "./wazzup-ingest.controller";

describe("WazzupIngestController", () => {
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
    } as never);

    await expect(controller.ingest({ messages: [inbound] })).resolves.toEqual({
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
    } as never);

    await controller.ingest({
      messages: [
        { ...inbound, messageId: "outbound-1", status: "outbound" },
        { ...inbound, messageId: "echo-1", isEcho: true },
      ],
    });

    expect(relayInbound).toHaveBeenCalledWith({
      messages: [
        { ...inbound, messageId: "outbound-1", status: "outbound" },
        { ...inbound, messageId: "echo-1", isEcho: true },
      ],
    });
    expect(handle).not.toHaveBeenCalled();
  });
});
