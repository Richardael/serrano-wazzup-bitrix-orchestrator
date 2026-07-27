import { Injectable, Logger } from "@nestjs/common";
import OpenAI from "openai";
import { ConversationPlanSchema, ConversationPlan } from "../../domain/catalog/conversation-plan.schema";

const MAX_TOKENS = 600;

const FALLBACK_PLAN: ConversationPlan = {
  intent: "GREETING",
  extractedFacts: {
    customerName: null,
    productCategory: null,
    productNames: [],
    spaceType: null,
    state: null,
    city: null,
    measurements: null,
    seats: null,
    preferredConfiguration: null,
    preferredMaterials: [],
  },
  catalogAction: "NONE",
  catalogQuery: null,
  nextQuestionPurpose: null,
  handoffRequired: false,
  handoffReason: null,
};

@Injectable()
export class ConversationPlanner {
  private readonly logger = new Logger(ConversationPlanner.name);
  private readonly client: OpenAI | null;

  constructor() {
    const apiKey = process.env["OPENROUTER_API_KEY"];
    if (apiKey) {
      this.client = new OpenAI({
        baseURL: "https://openrouter.ai/api/v1",
        apiKey,
      });
    } else {
      this.logger.warn("OPENROUTER_API_KEY not set — ConversationPlanner disabled");
      this.client = null;
    }
  }

  async plan(
    history: Array<{ role: string; content: string }>,
    currentFacts: Record<string, unknown>,
    catalogResults: Array<{ name: string; category: string; configurations: string[]; slug: string }>,
  ): Promise<ConversationPlan> {
    if (!this.client) return FALLBACK_PLAN;

    const systemPrompt = this.buildSystemPrompt(currentFacts, catalogResults);
    const userPrompt = this.buildUserPrompt(history);
    const plan = await this.callWithRetry(systemPrompt, userPrompt);
    return plan ?? FALLBACK_PLAN;
  }

  private buildSystemPrompt(
    facts: Record<string, unknown>,
    catalogResults: Array<{ name: string; category: string; configurations: string[]; slug: string }>,
  ): string {
    let prompt = `Eres un planificador de conversaciones para Serrano & Bustamante, firma venezolana de diseño interior especializada en iluminación decorativa, mobiliario a medida, diseño de interiores, domótica y ejecución de obra. Analizas conversaciones de WhatsApp entre un potencial cliente y un asesor virtual.

Detecta la INTENCIÓN del cliente entre estas opciones:
- GREETING: saludo o presentación inicial
- CATALOG_DISCOVERY: quiere explorar qué productos ofrecen
- PRODUCT_SEARCH: busca un tipo de producto específico
- PRODUCT_DETAILS: quiere detalles de un producto ya mencionado
- PRICE_REQUEST: pregunta por precios de productos
- AVAILABILITY_REQUEST: pregunta si hay disponibilidad
- QUOTE_REQUEST: pide una cotización formal
- VISIT_REQUEST: quiere agendar una visita o cita
- HUMAN_REQUEST: pide explícitamente hablar con una persona
- PROJECT_DISCOVERY: quiere información sobre servicios de diseño de interiores o proyectos
- UNRELATED: tema que no tiene relación con diseño interior ni productos

Extrae estos DATOS del cliente (usa null si no se mencionan):
- customerName: nombre de la persona
- productCategory: categoría (iluminación, mobiliario, domótica, etc.)
- productNames: array de nombres de productos mencionados
- spaceType: tipo de espacio (sala, oficina, comedor, terraza, dormitorio, cocina, local comercial, exterior)
- state: estado de Venezuela mencionado
- city: ciudad mencionada
- measurements: medidas o dimensiones mencionadas
- seats: número de puestos/asientos si se menciona (número entero positivo)
- preferredConfiguration: configuración preferida (ej: "2 plazas", "rectangular")
- preferredMaterials: array de materiales mencionados (ej: ["madera", "cuero"])

Determina catalogAction:
- NONE: no se necesita buscar en el catálogo
- SEARCH: buscar productos. Debes proveer catalogQuery con los términos de búsqueda.
- DETAILS: mostrar detalles de un producto ya identificado. catalogQuery debe contener el slug o nombre exacto.

Determina nextQuestionPurpose: qué pregunta debería hacerse a continuación (o null si ya tiene suficiente información).

Determina handoffRequired: true si la intención es PRICE_REQUEST, AVAILABILITY_REQUEST, QUOTE_REQUEST, VISIT_REQUEST, o HUMAN_REQUEST. En esos casos, provee handoffReason.`;

    if (Object.keys(facts).length > 0 && Object.values(facts).some((v) => v !== null && v !== undefined)) {
      prompt += `\n\nDATOS YA CONOCIDOS DEL CLIENTE (no los extraigas de nuevo a menos que el cliente los corrija):\n${JSON.stringify(facts, null, 2)}`;
    }

    if (catalogResults.length > 0) {
      const resultsSummary = catalogResults.slice(0, 5).map((r) => `- ${r.name} (${r.category}, configuraciones: ${r.configurations.join(", ")})`).join("\n");
      prompt += `\n\nRESULTADOS DEL CATÁLOGO YA DISPONIBLES:\n${resultsSummary}`;
    }

    prompt += `\n\nResponde ÚNICAMENTE con un objeto JSON válido que siga este esquema exacto. Sin explicaciones, sin markdown, sin backticks:
{
  "intent": "GREETING",
  "extractedFacts": {
    "customerName": null,
    "productCategory": null,
    "productNames": [],
    "spaceType": null,
    "state": null,
    "city": null,
    "measurements": null,
    "seats": null,
    "preferredConfiguration": null,
    "preferredMaterials": []
  },
  "catalogAction": "NONE",
  "catalogQuery": null,
  "nextQuestionPurpose": null,
  "handoffRequired": false,
  "handoffReason": null
}`;

    return prompt;
  }

  private buildUserPrompt(history: Array<{ role: string; content: string }>): string {
    const formatted = history
      .map((turn) => `${turn.role === "assistant" ? "ASESOR" : "CLIENTE"}: ${turn.content}`)
      .join("\n");

    return `HISTORIAL DE CONVERSACIÓN:\n${formatted}\n\nAnaliza la conversación y genera el JSON de planificación.`;
  }

  private async callWithRetry(systemPrompt: string, userPrompt: string): Promise<ConversationPlan | null> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const messages: Array<{ role: "system" | "user"; content: string }> = [
          { role: "system", content: systemPrompt },
        ];

        if (attempt === 0) {
          messages.push({ role: "user", content: userPrompt });
        } else {
          messages.push({ role: "user", content: `${userPrompt}\n\nTu respuesta anterior no era JSON válido. Responde SOLO con JSON, sin explicaciones.` });
        }

        const completion = await this.client!.chat.completions.create({
          model: "openai/gpt-4o-mini",
          messages,
          max_tokens: MAX_TOKENS,
          temperature: 0.1,
        });

        const text = completion.choices[0]?.message?.content;
        if (!text) {
          this.logger.warn("Empty response from OpenRouter (plan)");
          continue;
        }

        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          this.logger.warn(`No JSON found in planner response (attempt ${attempt + 1})`);
          continue;
        }

        const parsed = ConversationPlanSchema.parse(JSON.parse(jsonMatch[0]));
        this.logger.log(`Plan: intent=${parsed.intent}, catalogAction=${parsed.catalogAction}`);
        return parsed;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Planner attempt ${attempt + 1} failed: ${msg}`);
      }
    }

    this.logger.error("Planner failed after 2 attempts, using fallback");
    return null;
  }
}
