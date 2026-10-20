import { Body, Controller, Headers, HttpCode, Post, UnauthorizedException, BadRequestException, ServiceUnavailableException } from "@nestjs/common";
import { z } from "zod";
import { AppConfig } from "../../infrastructure/config/app.config";
import { bearerTokenMatches } from "../../infrastructure/security/secret-comparison";
import { NotificationRoutingService } from "../../application/services/notification-routing.service";

const RegisterSchema = z
  .object({
    phone: z.string().trim().min(6).max(24),
    source: z.string().trim().min(1).max(40).default("appsb"),
    messageId: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

/**
 * AppSB avisa aqui ANTES de enviar una notificacion. Secreto propio
 * (`NOTIFICATION_API_SECRET`), distinto del que usa el bot; sin configurar, el
 * endpoint responde 401 y no registra nada.
 */
@Controller("internal")
export class NotificationMarkerController {
  constructor(
    private readonly config: AppConfig,
    private readonly routing: NotificationRoutingService,
  ) {}

  @Post("notification-sent")
  @HttpCode(201)
  async register(
    @Body() body: unknown,
    @Headers("authorization") authorization: string | undefined,
  ): Promise<{ registered: true; expiresAt: string }> {
    if (!bearerTokenMatches(authorization, this.config.env.NOTIFICATION_API_SECRET)) {
      throw new UnauthorizedException("Invalid notification authorization");
    }
    const parsed = RegisterSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("Invalid notification payload");

    const result = await this.routing
      .register({ phone: parsed.data.phone, source: parsed.data.source, messageId: parsed.data.messageId ?? null })
      .catch(() => {
        throw new ServiceUnavailableException("Notification registry unavailable");
      });
    if (!result) throw new BadRequestException("Invalid phone number");
    return { registered: true, expiresAt: result.expiresAt.toISOString() };
  }
}
