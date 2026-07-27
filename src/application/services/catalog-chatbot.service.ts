import { Injectable, Logger, Inject } from "@nestjs/common";
import { WazzupPort } from "../ports/wazzup.port";
import { ConversationStatePort } from "../ports/conversation-state.port";
import { AppConfig } from "../../infrastructure/config/app.config";
import { OpenRouterAdapter } from "../../infrastructure/openrouter/openrouter.adapter";
import { ConversationPlanner } from "./conversation-planner.service";
import { LeadIntelligenceService } from "./lead-intelligence.service";
import { SearchCatalogUseCase } from "../use-cases/catalog/search-catalog.use-case";
import { GetProductDetailsUseCase } from "../use-cases/catalog/get-product-details.use-case";
import { ConversationPlan } from "../../domain/catalog/conversation-plan.schema";
import { ConversationFacts, DEFAULT_FACTS } from "../../domain/catalog/conversation-state.entity";
import { CatalogSearchResult } from "../../domain/catalog/catalog-product.entity";

const VENDOR_NAMES: Record<number, string> = {
  206: "Tahi",
  268: "Sabrina",
  308: "Paola",
};

const MAX_HISTORY = 20;

interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
  at: number;
}

@Injectable()
export class CatalogChatbotService {
  private readonly logger = new Logger(CatalogChatbotService.name);
  private readonly history = new Map<string, ConversationTurn[]>();

  constructor(
    @Inject("WAZZUP_PORT") private readonly wazzup: WazzupPort,
    private readonly config: AppConfig,
    private readonly ai: OpenRouterAdapter,
    private readonly planner: ConversationPlanner,
    private readonly leadIntel: LeadIntelligenceService,
    @Inject("CATALOG_REPOSITORY") private readonly searchCatalog: SearchCatalogUseCase,
    @Inject("CATALOG_REPOSITORY") private readonly getProductDetails: GetProductDetailsUseCase,
    @Inject("CONVERSATION_STATE") private readonly stateRepo: ConversationStatePort,
  ) {}

  async handleMessage(
    contactName: string | null,
    messageText: string,
    chatId: string,
    channelId: string,
    vendorId: number,
    leadId: string,
  ): Promise<string | null> {
    if (!this.wazzup.isEnabled || !chatId) return null;
    if (!channelId.startsWith("f207")) return null;

    if (!this.config.env.CATALOG_CHATBOT_ENABLED) return null;

    const isShadow = this.config.env.CATALOG_CHATBOT_SHADOW_MODE;
    const vendor = VENDOR_NAMES[vendorId] ?? "nuestro equipo";

    const state = await this.stateRepo.findByChatId(chatId);
    const existingFacts: ConversationFacts = state?.facts ?? { ...DEFAULT_FACTS };

    const turns = this.history.get(chatId) ?? [];
    turns.push({ role: "user", content: messageText, at: Date.now() });

    const historyForPlanner = turns.map((t) => ({ role: t.role, content: t.content }));

    const plan = await this.planner.plan(historyForPlanner, existingFacts as unknown as Record<string, unknown>, []);

    const mergedFacts = mergeFacts(existingFacts, plan.extractedFacts);

    let catalogResults: readonly CatalogSearchResult[] = [];

    if (plan.catalogAction === "SEARCH" && plan.catalogQuery) {
      try {
        catalogResults = await this.searchCatalog.execute({
          query: plan.catalogQuery,
          category: mergedFacts.productCategory ?? undefined,
          configuration: mergedFacts.preferredConfiguration ?? undefined,
          material: (mergedFacts.preferredMaterials as readonly string[])?.[0] ?? undefined,
          seats: mergedFacts.seats ?? undefined,
          limit: 5,
        });
        this.logger.log(`Catalog search '${plan.catalogQuery}': ${catalogResults.length} results`);
      } catch (err: unknown) {
        this.logger.error(`Catalog search error: ${err}`);
      }
    }

    if (plan.catalogAction === "DETAILS" && plan.catalogQuery) {
      try {
        const details = await this.getProductDetails.execute(plan.catalogQuery);
        if (details) {
          catalogResults = [
            {
              productId: details.id,
              slug: details.slug,
              name: details.name,
              category: details.category,
              matchedFacts: [],
              sourcePages: details.sourcePages as readonly number[],
              score: 1,
            },
          ];
        }
      } catch (err: unknown) {
        this.logger.error(`Product details error: ${err}`);
      }
    }

    const systemPrompt = buildResponsePrompt(mergedFacts, catalogResults, vendor, contactName, plan);

    const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      { role: "system", content: systemPrompt },
    ];

    for (const turn of turns) {
      messages.push({ role: turn.role, content: turn.content });
    }

    const response = await this.ai.chat(messages);

    if (!response) {
      this.logger.warn(`Empty AI response for ${chatId}`);
      return null;
    }

    turns.push({ role: "assistant", content: response, at: Date.now() });

    while (turns.length > MAX_HISTORY) {
      turns.shift();
    }

    this.history.set(chatId, turns);

    if (plan.handoffRequired) {
      const simpleHistory = turns.map((t) => ({ role: t.role, content: t.content }));
      this.leadIntel
        .updateLeadFromHistory(leadId, simpleHistory, contactName, vendor)
        .catch((e: unknown) => this.logger.error(`Lead update error: ${e}`));
    }

    try {
      await this.stateRepo.upsert({
        chatId,
        normalizedPhone: state?.normalizedPhone ?? "",
        leadId,
        assignedVendorId: vendorId,
        stage: "CATALOG_CHAT",
        lastIntent: plan.intent,
        facts: mergedFacts,
        handoffRequested: plan.handoffRequired,
        handoffReason: plan.handoffReason,
      });
    } catch (err: unknown) {
      this.logger.error(`Failed to save conversation state: ${err}`);
    }

    if (isShadow) {
      this.logger.log(`[SHADOW] chatId=${chatId} intent=${plan.intent} response=${response.substring(0, 200)}`);
    }

    this.cleanupHistory();

    return response;
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

function mergeFacts(
  existing: ConversationFacts,
  extracted: ConversationPlan["extractedFacts"],
): ConversationFacts {
  return {
    customerName: extracted.customerName ?? existing.customerName,
    productCategory: extracted.productCategory ?? existing.productCategory,
    productNames: extracted.productNames.length > 0 ? extracted.productNames : existing.productNames,
    spaceType: extracted.spaceType ?? existing.spaceType,
    state: extracted.state ?? existing.state,
    city: extracted.city ?? existing.city,
    measurements: extracted.measurements ?? existing.measurements,
    seats: extracted.seats ?? existing.seats,
    preferredConfiguration: extracted.preferredConfiguration ?? existing.preferredConfiguration,
    preferredMaterials:
      extracted.preferredMaterials.length > 0 ? extracted.preferredMaterials : existing.preferredMaterials,
    selectedProductSlug: existing.selectedProductSlug,
  };
}

function buildResponsePrompt(
  facts: ConversationFacts,
  products: readonly CatalogSearchResult[],
  vendor: string,
  contactName: string | null,
  plan: ConversationPlan,
): string {
  const name = facts.customerName ?? contactName ?? "";

  let prompt = `Eres asesora de diseño de Serrano & Bustamante, firma venezolana de diseño interior: iluminación decorativa, mobiliario a medida, diseño de interiores, domótica y ejecución de obra. Atiendes por WhatsApp.

TONO:
- Cálida pero profesional. Como una diseñadora que recibe a un cliente en su estudio.
- Sin exageraciones. Nada de "qué emoción" o "nos encanta". Sobria y elegante.
- Frases de 2 a 3 líneas. Clara, directa, servicial.
- Tuteas con naturalidad. Lenguaje sencillo.
- Español venezolano.

`;

  const factLines: string[] = [];
  if (name) factLines.push(`- Nombre: ${name}`);
  if (facts.productCategory) factLines.push(`- Categoría de interés: ${facts.productCategory}`);
  if (facts.productNames.length > 0) factLines.push(`- Productos mencionados: ${facts.productNames.join(", ")}`);
  if (facts.spaceType) factLines.push(`- Espacio: ${facts.spaceType}`);
  if (facts.state) factLines.push(`- Estado: ${facts.state}`);
  if (facts.city) factLines.push(`- Ciudad: ${facts.city}`);
  if (facts.measurements) factLines.push(`- Medidas: ${facts.measurements}`);
  if (facts.seats) factLines.push(`- Puestos: ${facts.seats}`);
  if (facts.preferredConfiguration) factLines.push(`- Configuración preferida: ${facts.preferredConfiguration}`);
  if (facts.preferredMaterials.length > 0) factLines.push(`- Materiales preferidos: ${facts.preferredMaterials.join(", ")}`);

  if (factLines.length > 0) {
    prompt += `DATOS CONOCIDOS DEL CLIENTE:\n${factLines.join("\n")}\n\n`;
  }

  if (products.length > 0) {
    prompt += `PRODUCTOS DEL CATÁLOGO QUE COINCIDEN (recomienda máximo 3):\n`;
    products.slice(0, 3).forEach((p, i) => {
      prompt += `${i + 1}. ${p.name} — ${p.category}`;
      if (p.matchedFacts.length > 0) {
        prompt += ` [coincide en: ${p.matchedFacts.join(", ")}]`;
      }
      prompt += "\n";
    });
    prompt += "\n";
  } else if (plan.catalogAction === "SEARCH") {
    prompt += `No se encontraron productos en el catálogo que coincidan con la búsqueda.\n\n`;
  }

  prompt += `POLÍTICAS COMERCIALES:
- NUNCA menciones precios, disponibilidad ni plazos de entrega.
- NUNCA digas que eres IA, chatbot ni asistente virtual.
- NUNCA inventes productos, configuraciones, materiales ni colores. Solo recomienda productos del catálogo listados arriba.
- NUNCA repitas saludos si ya saludaste en esta conversación.
- NUNCA preguntes datos que YA aparecen en DATOS CONOCIDOS.

- Máximo UNA pregunta por mensaje. Nunca un checklist.
- Reconoce primero lo que el cliente dijo en su último mensaje.
- Usa el nombre del cliente con moderación, no en cada mensaje.
- Máximo 3 recomendaciones de productos. Explica cada uno en una frase breve.
- Si no hay productos del catálogo que coincidan, dilo con sinceridad.
- Si el cliente pide algo que no está en el catálogo, ofrécele hablar con un asesor.

`;

  if (plan.handoffRequired) {
    prompt += `CIERRE POR DERIVACIÓN:
El cliente necesita ser derivado a un asesor humano (${vendor}). Motivo: ${plan.handoffReason ?? "solicitado por el cliente"}.
Cierra la conversación con un mensaje cordial informando que ${vendor} lo contactará pronto. NO hagas más preguntas. NO ofrezcas productos.\n\n`;
  } else if (plan.nextQuestionPurpose) {
    prompt += `OBJETIVO DE LA PREGUNTA:
${plan.nextQuestionPurpose}\n\n`;
  }

  if (plan.handoffRequired) {
    prompt += `VENDEDOR ASIGNADO: ${vendor}`;
  }

  return prompt;
}
