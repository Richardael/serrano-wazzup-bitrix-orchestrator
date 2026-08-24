import { BotInboundRelayService } from "./bot-inbound-relay.service";

describe("BotInboundRelayService", () => {
  const config = {
    env: {
      BOT_INTERNAL_BASE_URL: "http://bot:3002",
      ORCHESTRATOR_SHARED_SECRET: "shared-secret-value",
    },
  } as never;

  it("forwards only raw inbound messages", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response("", { status: 200 }));
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
    expect(request.headers).toMatchObject({ Authorization: "Bearer shared-secret-value" });
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
});
