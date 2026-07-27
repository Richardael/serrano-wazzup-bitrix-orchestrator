import { Injectable, Logger } from "@nestjs/common";
import OpenAI from "openai";

@Injectable()
export class OpenRouterAdapter {
  private readonly logger = new Logger(OpenRouterAdapter.name);
  private readonly client: OpenAI | null;

  constructor() {
    const apiKey = process.env["OPENROUTER_API_KEY"];
    if (apiKey) {
      this.client = new OpenAI({
        baseURL: "https://openrouter.ai/api/v1",
        apiKey,
      });
      this.logger.log("OpenRouter initialized");
    } else {
      this.logger.warn("OPENROUTER_API_KEY not set — AI chatbot disabled");
      this.client = null;
    }
  }

  get isEnabled(): boolean {
    return this.client !== null;
  }

  async chat(
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  ): Promise<string | null> {
    if (!this.client) return null;

    try {
      const completion = await this.client.chat.completions.create({
        model: "openai/gpt-4o-mini",
        messages,
        max_tokens: 300,
        temperature: 0.7,
      });

      return completion.choices[0]?.message?.content ?? null;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`OpenRouter error: ${msg}`);
      return null;
    }
  }
}
