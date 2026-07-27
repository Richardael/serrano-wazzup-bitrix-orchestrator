import { Injectable, Logger } from "@nestjs/common";
import { WazzupPort, SendMessageInput } from "../../application/ports/wazzup.port";

interface WazzupChannel {
  channelId: string;
  transport: string;
  state: string;
  plainId: string;
  name: string;
}

interface WazzupWebhookConfig {
  webhooksUri: string | null;
  subscriptions: {
    messagesAndStatuses: boolean;
    contactsAndDealsCreation: boolean;
    channelsUpdates: boolean;
    wabaTemplatesStatus: boolean;
  };
}

@Injectable()
export class WazzupHttpAdapter implements WazzupPort {
  private readonly logger = new Logger(WazzupHttpAdapter.name);
  private readonly baseUrl = "https://api.wazzup24.com/v3";
  private readonly apiKey: string;

  constructor() {
    const key = process.env["WAZZUP_API_KEY"];
    if (!key) {
      this.logger.warn("WAZZUP_API_KEY not set — Wazzup integration disabled");
      this.apiKey = "";
    } else {
      this.apiKey = key;
    }
  }

  get isEnabled(): boolean {
    return this.apiKey.length > 0;
  }

  async getChannels(): Promise<WazzupChannel[]> {
    return this.request<WazzupChannel[]>("channels");
  }

  async getWebhooks(): Promise<WazzupWebhookConfig> {
    return this.request<WazzupWebhookConfig>("webhooks");
  }

  async configureWebhook(uri: string, subscriptions: Record<string, boolean>): Promise<WazzupWebhookConfig> {
    return this.request<WazzupWebhookConfig>("webhooks", {
      method: "PATCH",
      body: JSON.stringify({ webhooksUri: uri, subscriptions }),
    });
  }

  async sendMessage(input: SendMessageInput): Promise<void> {
    this.logger.log(`Sending message to chat ${input.chatId} via channel ${input.channelId}`);
    await this.request<unknown>("message", {
      method: "POST",
      body: JSON.stringify({
        chatId: input.chatId,
        channelId: input.channelId,
        text: input.text,
      }),
    });
  }

  private async request<T>(path: string, options?: { method?: string; body?: string }): Promise<T> {
    if (!this.isEnabled) {
      throw new Error("Wazzup API key not configured");
    }

    const url = `${this.baseUrl}/${path}`;
    const method = options?.method ?? "GET";
    const requestBody = options?.body ?? null;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
      const init: RequestInit = {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
      };
      if (requestBody !== null) {
        init.body = requestBody;
      }

      const response = await fetch(url, init);

      clearTimeout(timeoutId);

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Wazzup API error ${response.status}: ${text}`);
      }

      return (await response.json()) as T;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
