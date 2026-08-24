import { UnauthorizedException } from "@nestjs/common";
import { BotIntegrationController } from "./bot-integration.controller";

describe("BotIntegrationController", () => {
  const config = {
    env: { ORCHESTRATOR_SHARED_SECRET: "shared-secret-value" },
  } as never;

  it("sends a valid bot outbound request through the Wazzup adapter", async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const controller = new BotIntegrationController(config, {
      sendMessage,
      isEnabled: true,
    });

    await expect(
      controller.sendOutbound(
        { channelId: "channel-1", chatId: "584121234567", text: "Hola" },
        "Bearer shared-secret-value",
      ),
    ).resolves.toEqual({ accepted: true });
    expect(sendMessage).toHaveBeenCalledWith({
      channelId: "channel-1",
      chatId: "584121234567",
      text: "Hola",
    });
  });

  it("rejects requests with an invalid shared secret", () => {
    const controller = new BotIntegrationController(config, {
      sendMessage: vi.fn(),
      isEnabled: true,
    });

    return expect(
      controller.sendOutbound(
        { channelId: "channel-1", chatId: "584121234567", text: "Hola" },
        "Bearer incorrect",
      ),
    ).rejects.toThrow(UnauthorizedException);
  });
});
