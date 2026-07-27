import { Injectable, Logger, Inject } from "@nestjs/common";
import { WazzupPort } from "../ports/wazzup.port";
import { AppConfig } from "../../infrastructure/config/app.config";

const WAZZUP_PORT = "WAZZUP_PORT";

const VENDOR_NAMES: Record<number, string> = {
  206: "Tahi",
  268: "Sabrina",
  308: "Paola",
};

interface KeywordRule {
  keywords: string[];
  response: (name: string, vendor: string) => string;
}

@Injectable()
export class ChatbotService {
  private readonly logger = new Logger(ChatbotService.name);

  private readonly rules: KeywordRule[] = [
    {
      keywords: ["cotización", "cotizacion", "precio", "costo", "presupuesto", "cuánto", "cuanto"],
      response: (name) =>
        `¡Claro ${name}! Para enviarte una cotización necesitamos algunos datos:\n` +
        `1. ¿Cuál es el espacio a intervenir?\n` +
        `2. ¿Tienes medidas aproximadas?\n` +
        `3. ¿Qué estilo te gusta?\n\n` +
        `Tu asesora te contactará pronto para ayudarte.`,
    },
    {
      keywords: ["catálogo", "catalogo", "productos", "ver", "fotos", "imagenes", "imágenes"],
      response: (name) =>
        `¡Hola ${name}! 😊 Puedes ver nuestros trabajos en Instagram @serranobustamante. ¿Hay algo en particular que te interese?`,
    },
    {
      keywords: ["cita", "visita", "agendar", "cuándo", "cuando", "horario", "disponible"],
      response: (name, vendor) =>
        `¡Por supuesto ${name}! ${vendor} te contactará pronto para coordinar una visita. ¿Qué día y horario te funciona mejor?`,
    },
    {
      keywords: ["hola", "buenos días", "buenas tardes", "buenas noches", "saludos", "buenas"],
      response: (name, vendor) =>
        `¡Hola ${name}! 👋 Somos Serrano & Bustamante. ${vendor} te atenderá personalmente. ¿En qué podemos ayudarte?`,
    },
  ];

  private readonly welcomeMessage = (name: string, vendor: string): string =>
    `¡Hola ${name}! 👋 Somos Serrano & Bustamante, expertos en iluminación, diseño de interiores y mobiliario. ` +
    `${vendor} te atenderá personalmente. ¿En qué podemos ayudarte?`;

  constructor(
    @Inject(WAZZUP_PORT) private readonly wazzup: WazzupPort,
    private readonly config: AppConfig,
  ) {}

  async handleNewLead(
    contactName: string | null,
    chatId: string,
    channelId: string,
    vendorId: number,
  ): Promise<void> {
    if (!this.wazzup.isEnabled) return;

    const name = contactName ?? "Hola";
    const vendor = VENDOR_NAMES[vendorId] ?? "nuestro equipo";
    const text = this.welcomeMessage(name, vendor);

    try {
      await this.wazzup.sendMessage({ chatId, channelId, text });
      this.logger.log(`Welcome sent to ${chatId}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to send welcome: ${msg}`);
    }
  }

  async handleIncomingMessage(
    contactName: string | null,
    messageText: string,
    chatId: string,
    channelId: string,
    vendorId: number,
    isNewLead: boolean,
  ): Promise<void> {
    if (!this.wazzup.isEnabled || !messageText.trim()) return;

    const name = contactName ?? "Hola";
    const vendor = VENDOR_NAMES[vendorId] ?? "nuestro equipo";
    const lower = messageText.toLowerCase().trim();

    if (isNewLead) {
      await this.wazzup.sendMessage({ chatId, channelId, text: this.welcomeMessage(name, vendor) });
      return;
    }

    for (const rule of this.rules) {
      if (rule.keywords.some((kw) => lower.includes(kw))) {
        try {
          await this.wazzup.sendMessage({ chatId, channelId, text: rule.response(name, vendor) });
          this.logger.log(`Keyword response sent for "${lower.slice(0, 50)}"`);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.error(`Failed to send keyword response: ${msg}`);
        }
        return;
      }
    }
  }
}
