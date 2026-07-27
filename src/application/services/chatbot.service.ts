import { Injectable, Logger, Inject } from "@nestjs/common";
import { WazzupPort } from "../ports/wazzup.port";
import { AppConfig } from "../../infrastructure/config/app.config";
import { OpenRouterAdapter } from "../../infrastructure/openrouter/openrouter.adapter";

const VENDOR_NAMES: Record<number, string> = {
  206: "Tahi",
  268: "Sabrina",
  308: "Paola",
};

const MAX_HISTORY = 6;

interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
  at: number;
}

@Injectable()
export class ChatbotService {
  private readonly logger = new Logger(ChatbotService.name);
  private readonly history = new Map<string, ConversationTurn[]>();

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

    const systemPrompt = `Eres asesora de diseño de Serrano & Bustamante, firma venezolana de diseño interior: iluminación decorativa, mobiliario a medida, diseño de interiores, domótica y ejecución de obra. Atiendes por WhatsApp.

TONO:
- Cálida pero profesional. Como una diseñadora que recibe a un cliente en su estudio.
- Sin exageraciones. Nada de "¡qué emoción!" o "nos encanta". Sé sobria y elegante.
- Frases de 2 a 3 líneas. Clara, directa, servicial.
- Tuteas con naturalidad. Lenguaje sencillo, sin palabras rebuscadas.

CÓMO CONVERSAR:
- LEE el historial de la conversación antes de responder. No repitas preguntas que ya hiciste y el cliente ya contestó.
- Reconoce primero lo que el cliente dijo: si menciona color, tipo de producto o espacio, demuestra que lo leíste.
- Una sola pregunta por mensaje. Nunca un checklist.
- No listes categorías ni opciones. Sé conversacional.

QUÉ NECESITAS SABER (en orden, una cosa a la vez):
1. Nombre del cliente (si no lo tienes aún)
2. Qué producto o proyecto le interesa
3. Para qué espacio (sala, oficina, terraza, local...)
4. En qué ciudad o estado de Venezuela está
5. Medidas aproximadas

CUÁNDO CERRAR:
Si el cliente ya te dio 4 o más datos (producto, color, espacio, ubicación, medidas...), NO sigas preguntando. Cierra así:
"Perfecto, {nombre}. Ya tengo todo lo que necesito. ${vendor} te contactará en breve para coordinar los detalles."

REGLAS:
- NUNCA menciones precios ni plazos.
- NUNCA digas que eres IA, chatbot, ni asistente virtual.
- NUNCA preguntes algo que el cliente YA respondió en esta conversación.
- Si no entiendes algo, dile que ${vendor} le aclarará personalmente.

${name ? `El cliente se llama ${name}.` : "Pregunta el nombre apenas puedas, de forma natural."}`;

    const turns = this.history.get(chatId) ?? [];

    const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      { role: "system", content: systemPrompt },
    ];

    if (isNewLead && name && turns.length === 0) {
      messages.push({
        role: "assistant",
        content: `¡Hola ${name}! Soy asesora de Serrano & Bustamante. ¿En qué te puedo ayudar?`,
      });
    }

    for (const turn of turns) {
      messages.push({ role: turn.role, content: turn.content });
    }

    messages.push({ role: "user", content: messageText });

    turns.push({ role: "user", content: messageText, at: Date.now() });

    const response = await this.ai.chat(messages);

    if (response) {
      turns.push({ role: "assistant", content: response, at: Date.now() });

      while (turns.length > MAX_HISTORY) {
        turns.shift();
      }

      this.history.set(chatId, turns);

      try {
        await this.wazzup.sendMessage({ chatId, channelId, text: response });
        this.logger.log(`AI response sent to ${chatId}`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Failed to send AI response: ${msg}`);
      }
    }

    this.cleanupHistory();
  }

  private cleanupHistory(): void {
    const cutoff = Date.now() - 60 * 60 * 1000;
    for (const [key, turns] of this.history) {
      const filtered = turns.filter((t) => t.at > cutoff);
      if (filtered.length === 0) {
        this.history.delete(key);
      } else {
        this.history.set(key, filtered);
      }
    }
  }
}
