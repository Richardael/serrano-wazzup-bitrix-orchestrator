import { BadRequestException, Body, Controller, Headers, Inject, Post, UnauthorizedException } from "@nestjs/common";
import { AppConfig } from "../../infrastructure/config/app.config";
import { SendMessageInput, WAZZUP_PORT, WazzupPort } from "../../application/ports/wazzup.port";
import { BotOutboundMessageRequest, BotOutboundMessageResponse } from "./bot-integration.contract";

@Controller("internal")
export class BotIntegrationController {
  constructor(
    private readonly config: AppConfig,
    @Inject(WAZZUP_PORT) private readonly wazzup: WazzupPort,
  ) {}

  @Post("bot-outbound")
  async sendOutbound(
    @Body() body: BotOutboundMessageRequest,
    @Headers("authorization") authorization: string | undefined,
  ): Promise<BotOutboundMessageResponse> {
    const secret = this.config.env.ORCHESTRATOR_SHARED_SECRET;
    if (!secret || authorization !== `Bearer ${secret}`) {
      throw new UnauthorizedException("Invalid orchestrator authorization");
    }
    if (!this.isValidMessage(body)) {
      throw new BadRequestException("Invalid bot outbound message");
    }

    const input: SendMessageInput = {
      channelId: body.channelId,
      chatId: body.chatId,
      text: body.text,
    };
    await this.wazzup.sendMessage(input);
    return { accepted: true };
  }

  private isValidMessage(body: BotOutboundMessageRequest): boolean {
    return (
      typeof body?.channelId === "string" &&
      body.channelId.length > 0 &&
      typeof body.chatId === "string" &&
      body.chatId.length > 0 &&
      typeof body.text === "string" &&
      body.text.length > 0
    );
  }
}
