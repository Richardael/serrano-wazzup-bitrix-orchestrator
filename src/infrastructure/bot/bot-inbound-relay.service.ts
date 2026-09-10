import { Injectable, Logger, Optional } from "@nestjs/common";
import { AppConfig } from "../config/app.config";
import { BotInboundWazzupPayload } from "../../interfaces/internal/bot-integration.contract";

@Injectable()
export class BotInboundRelayService {
  private readonly logger = new Logger(BotInboundRelayService.name);

  constructor(
    private readonly config: AppConfig,
    @Optional() private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async relayInbound(payload: Record<string, unknown>): Promise<void> {
    if (!this.config.env.BOT_INTERNAL_BASE_URL) return;

    const messages = Array.isArray(payload["messages"])
      ? payload["messages"]
          .filter(
            (message): message is Record<string, unknown> =>
              typeof message === "object" &&
              message !== null &&
              message["status"] === "inbound" &&
              message["isEcho"] !== true,
          )
          .map((message) => this.withProfileName(message, payload))
      : [];
    if (messages.length === 0) return;

    const { statuses: _statuses, ...rawInboundPayload } = payload;
    const body: BotInboundWazzupPayload = { ...rawInboundPayload, messages };
    const url = `${this.config.env.BOT_INTERNAL_BASE_URL.replace(/\/$/, "")}/wazzup/internal/orchestrator-ingest`;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < 2; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      try {
        const response = await this.fetchFn(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.config.env.ORCHESTRATOR_SHARED_SECRET}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (response.ok) return;
        lastError = new Error(`Bot relay failed with HTTP ${response.status}`);
      } catch (error) {
        lastError =
          error instanceof Error ? error : new Error("Unknown bot relay error");
      } finally {
        clearTimeout(timeout);
      }
      await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
    }

    this.logger.warn(
      `Bot relay failed after retries: ${lastError?.message ?? "unknown error"}`,
    );
  }

  private withProfileName(
    message: Record<string, unknown>,
    payload: Record<string, unknown>,
  ): Record<string, unknown> {
    const nestedMessageChat = this.objectValue(message["chat"]);
    const nestedPayloadChat = this.objectValue(payload["chat"]);
    const nestedPayloadContact = this.objectValue(payload["contact"]);
    const contacts = Array.isArray(payload["contacts"])
      ? payload["contacts"].filter(
          (contact): contact is Record<string, unknown> =>
            typeof contact === "object" && contact !== null,
        )
      : [];
    const contactName = this.firstText(
      contacts.map((contact) => contact["name"]),
    );
    const authorName = this.firstText([
      message["authorName"],
      message["chatName"],
      nestedMessageChat?.["name"],
      message["contactName"],
      nestedPayloadChat?.["name"],
      nestedPayloadContact?.["name"],
      contactName,
    ]);
    if (!authorName) return message;

    return {
      ...message,
      authorName: this.firstText([message["authorName"], authorName]),
      chatName: this.firstText([
        message["chatName"],
        nestedMessageChat?.["name"],
        nestedPayloadChat?.["name"],
        authorName,
      ]),
      contactName: this.firstText([
        message["contactName"],
        contactName,
        authorName,
      ]),
    };
  }

  private objectValue(value: unknown): Record<string, unknown> | undefined {
    return typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : undefined;
  }

  private firstText(values: unknown[]): string | undefined {
    return values
      .find(
        (value): value is string =>
          typeof value === "string" && value.trim().length > 0,
      )
      ?.trim();
  }
}
