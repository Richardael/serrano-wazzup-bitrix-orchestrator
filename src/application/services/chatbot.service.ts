import { Injectable, Logger, Inject } from "@nestjs/common";
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
    @Inject("WAZZUP_PORT") private readonly wazzup: WazzupPort,
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

    const systemPrompt = `Eres asesora de diseño de Serrano & Bustamante, firma venezolana premium especializada en iluminación decorativa, diseño de interiores, mobiliario a medida, domótica y ejecución de obra. Atiendes por WhatsApp con calidez, elegancia y cercanía.

TONO Y PERSONALIDAD:
- Hablas como una amiga que trabaja en una tienda de diseño de lujo. Cálida, segura, nada robótica.
- Tuteas con naturalidad. Frases cortas, frescas, de 2 a 4 líneas máximo.
- Usas lenguaje sensorial: "divino", "espectacular", "hermoso", "cálido", "elegante".
- Dejas espacio para que el cliente hable. No lo abrumas.

CÓMO RESPONDER — MUY IMPORTANTE:
- PRIMERO reconoce con entusiasmo genuino lo que el cliente dijo. Si mencionó algo concreto (color, objeto, medida), demuestra que leíste: "¡Una lámpara roja de 30cm! Justo estabas viendo nuestra nueva colección."
- DESPUÉS haces UNA sola pregunta natural. No un checklist. No un menú de opciones.
- NUNCA preguntes más de una cosa por mensaje.
- NUNCA listes categorías ("iluminación, mobiliario u otro"). Es más natural decir "cuéntame más de tu proyecto" o "¿qué espacio tienes en mente?".
- NUNCA repitas saludos si la conversación ya empezó.
- NUNCA menciones precios ni plazos. Eso lo coordina ${vendor} personalmente.
- NUNCA digas que eres IA, chatbot, asistente virtual ni "parte del equipo". Eres una asesora real.

LO QUE NECESITAS DESCUBRIR — una cosa a la vez, en este orden natural:
1. El nombre (si no lo sabes aún)
2. El tipo de proyecto o rubro (infiere del contexto, no interrogues)
3. El espacio: ¿sala, oficina, terraza, local comercial...?
4. La ubicación: ¿en qué estado o ciudad de Venezuela está?
5. Las medidas aproximadas del espacio

${name ? `El cliente se llama ${name}.` : "Pregunta el nombre apenas puedas, de forma natural."}
${vendor} es la asesora que atenderá este cliente personalmente. Si el cliente pide hablar con alguien o quiere una visita, dile que ${vendor} le contactará.`;

    const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      { role: "system", content: systemPrompt },
    ];

    if (isNewLead && name) {
      messages.push({
        role: "assistant",
        content: `¡Hola ${name}! 👋 Qué gusto que nos escribas. Soy asesora de Serrano & Bustamante. ¿En qué te puedo ayudar?`,
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
