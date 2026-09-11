import { BotInboundRelayService } from "./bot-inbound-relay.service";

describe("BotInboundRelayService", () => {
  const config = {
    env: {
      BOT_INTERNAL_BASE_URL: "http://bot:3002",
      ORCHESTRATOR_SHARED_SECRET: "shared-secret-value",
    },
  } as never;

  it("forwards only raw inbound messages", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(new Response("", { status: 200 }));
    const service = new BotInboundRelayService(config, fetchFn);
    const inbound = { messageId: "inbound-1", status: "inbound", text: "Hola" };

    await service.relayInbound({
      messages: [
        inbound,
        { messageId: "outbound-1", status: "outbound", text: "Adios" },
        { messageId: "echo-1", status: "inbound", isEcho: true, text: "Eco" },
      ],
      statuses: [{ messageId: "outbound-1", status: "sent" }],
    });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, request] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://bot:3002/wazzup/internal/orchestrator-ingest");
    expect(request.headers).toMatchObject({
      Authorization: "Bearer shared-secret-value",
    });
    expect(request.body).toBe(JSON.stringify({ messages: [inbound] }));
  });

  it("does not forward payloads containing only outbound or echo messages", async () => {
    const fetchFn = vi.fn();
    const service = new BotInboundRelayService(config, fetchFn);

    await service.relayInbound({
      messages: [
        { messageId: "outbound-1", status: "outbound" },
        { messageId: "echo-1", status: "inbound", isEcho: true },
      ],
    });

    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("propagates the WhatsApp profile name without empty name fields", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(new Response("", { status: 200 }));
    const service = new BotInboundRelayService(config, fetchFn);

    await service.relayInbound({
      chat: { name: "Brayan Gamboa" },
      messages: [{ messageId: "inbound-2", status: "inbound", text: "Hola" }],
    });

    const request = fetchFn.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body)) as {
      messages: Array<Record<string, unknown>>;
    };
    expect(body.messages[0]).toMatchObject({
      authorName: "Brayan Gamboa",
      chatName: "Brayan Gamboa",
      contactName: "Brayan Gamboa",
    });
    expect(body).toMatchObject({ authorName: "Brayan Gamboa", chatName: "Brayan Gamboa" });
  });

  it("reads the profile name from the native message contact", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response("", { status: 200 }));
    const service = new BotInboundRelayService(config, fetchFn);

    await service.relayInbound({
      messages: [{ messageId: "inbound-3", status: "inbound", text: "Hola", contact: { name: "Ana Native" } }],
    });

    const request = fetchFn.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body)) as Record<string, unknown>;
    expect(body).toMatchObject({ authorName: "Ana Native", chatName: "Ana Native" });
    expect((body.messages as Array<Record<string, unknown>>)[0]).toMatchObject({
      authorName: "Ana Native",
      chatName: "Ana Native",
      contactName: "Ana Native",
    });
  });

  it("relays native inbound messages identified by direction or type", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response("", { status: 200 }));
    const service = new BotInboundRelayService(config, fetchFn);

    await service.relayInbound({
      messages: [
        { messageId: "direction-1", direction: "inbound", text: "Hola" },
        { messageId: "type-1", type: "incoming", text: "Hola 2" },
      ],
    });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const request = fetchFn.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body)).messages).toHaveLength(2);
  });
});
