import { Injectable, Logger } from "@nestjs/common";
import { WazzupPort } from "../ports/wazzup.port";
import { AppConfig } from "../../infrastructure/config/app.config";
import { OpenRouterAdapter } from "../../infrastructure/openrouter/openrouter.adapter";

const VENDOR_NAMES: Record<number, string> = {
  206: "Tahi",
  268: "Sabrina",
  308: "Paola",
};

@Injectable()
export class ChatbotService {
  private readonly logger = new Logger(ChatbotService.name);

  constructor(
    private readonly wazzup: WazzupPort,
    private readonly config: AppConfig,
    private readonly ai: OpenRouterAdapter,
  ) {}

  async handleMessage(
    contactName: string | null,
    messageText: string,
    chatId: string,
    channelId: string,
    vendorId: number,
    isNewLead: boolean,
  ): Promise<void> {
    if (!this.wazzup.isEnabled || !chatId || !channelId) return;
    if (!channelId.startsWith("f207")) return;

    const name = contactName ?? "";
    const vendor = VENDOR_NAMES[vendorId] ?? "nuestro equipo";

    const systemPrompt = `Eres el asistente virtual de Serrano & Bustamante, una empresa venezolana de diseño de interiores, iluminación, mobiliario, domótica y ejecución de obra.

Tu trabajo es atender a clientes que escriben por WhatsApp, con un tono cálido, profesional y cercano.

REGLAS:
- Preséntate SOLO si es el primer mensaje del cliente.
- Siempre pregunta el nombre si no lo sabes.
- Averigua qué necesita: rubro (iluminación, mobiliario, diseño de interiores, domótica, redes, papel tapiz, paneles, ejecución de obra).
- Pide ubicación (estado de Venezuela) y medidas aproximadas.
- Si pregunta precios, explica que necesitas más datos para cotizar.
- NO inventes precios ni prometas plazos.
- Si el cliente pregunta algo que no sabes, dile que ${vendor} lo contactará.
- Máximo 3 oraciones por respuesta.
- NUNCA digas que eres una IA. Eres parte del equipo de ventas.

Cliente: ${name || "desconocido"}
Asesora asignada: ${vendor}`;

    const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      { role: "system", content: systemPrompt },
    ];

    if (isNewLead && name) {
      messages.push({
        role: "assistant",
        content: `¡Hola ${name}! 👋 Somos Serrano & Bustamante, expertos en iluminación y diseño de interiores. ${vendor} te atenderá personalmente. ¿En qué podemos ayudarte?`,
      });
    }

    messages.push({ role: "user", content: messageText });

    const response = await this.ai.chat(messages);

    if (response) {
      try {
        await this.wazzup.sendMessage({ chatId, channelId, text: response });
        this.logger.log(`AI response sent to ${chatId}`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Failed to send AI response: ${msg}`);
      }
    }
  }
}
