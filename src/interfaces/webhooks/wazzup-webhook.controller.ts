import {
  Controller,
  Post,
  Param,
  Headers,
  Body,
  Req,
  HttpCode,
  UnauthorizedException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import { WazzupWebhookSchema } from "./wazzup-webhook.schema";
import { IncomingMessageHandler } from "../../application/services/incoming-message.handler";
import { AppConfig } from "../../infrastructure/config/app.config";
import { Logger } from "@nestjs/common";

@Controller("webhooks/wazzup")
export class WazzupWebhookController {
  private readonly logger = new Logger(WazzupWebhookController.name);

  constructor(
    private readonly handler: IncomingMessageHandler,
    private readonly config: AppConfig,
  ) {}

  @Post(":webhookId")
  @HttpCode(200)
  async receive(
    @Param("webhookId") webhookId: string,
    @Headers("authorization") authorization: string | undefined,
    @Headers("content-type") contentType: string | undefined,
    @Body() body: unknown,
  ): Promise<{ status: string }> {
    if (webhookId !== this.config.env.WAZZUP_WEBHOOK_ID) {
      throw new UnauthorizedException("Invalid webhook ID");
    }

    if (!contentType || !contentType.includes("application/json")) {
      throw new UnsupportedMediaTypeException("Content-Type must be application/json");
    }

    const token = authorization?.replace("Bearer ", "");
    if (!token || token !== this.config.env.WAZZUP_WEBHOOK_BEARER_TOKEN) {
      throw new UnauthorizedException("Invalid bearer token");
    }

    const bodySize = JSON.stringify(body).length;
    if (bodySize > this.config.env.MAX_WEBHOOK_BODY_BYTES) {
      throw new PayloadTooLargeException("Payload exceeds maximum size");
    }

    const parsed = WazzupWebhookSchema.safeParse(body);
    if (!parsed.success) {
      this.logger.warn(`Invalid webhook payload: ${parsed.error.message}`);
      return { status: "invalid_payload" };
    }

    const result = await this.handler.handle(parsed.data);

    return { status: result.status };
  }
}
