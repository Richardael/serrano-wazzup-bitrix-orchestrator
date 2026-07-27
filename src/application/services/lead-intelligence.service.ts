import { Injectable, Logger } from "@nestjs/common";
import { OpenRouterAdapter } from "../../infrastructure/openrouter/openrouter.adapter";
import { Bitrix24Port, LeadUpdateFields } from "../ports/bitrix24.port";

interface ExtractedData {
  rubro?: string;
  espacio?: string;
  estado?: string;
  ciudad?: string;
  medidas?: string;
  producto?: string;
  observaciones?: string;
  camposLlenos: number;
}

const RUBRO_MAP: Record<string, string> = {
  "iluminación": "Iluminacion",
  "iluminacion": "Iluminacion",
  "mobiliario": "Mobiliario",
  "domótica": "Domotica",
  "domotica": "Domotica",
  "redes": "Redes",
  "diseño de interiores": "Diseño de interiores",
  "diseño interior": "Diseño de interiores",
  "papel tapiz": "Papel tapiz",
  "papel": "Papel tapiz",
  "paneles": "Paneles",
  "ejecución de obra": "Ejecución de obra",
  "ejecucion de obra": "Ejecución de obra",
};

const ESTADO_MAP: Record<string, string> = {
  "caracas": "Distrito Capital",
  "distrito capital": "Distrito Capital",
  "miranda": "Miranda",
  "zulia": "Zulia",
  "maracaibo": "Zulia",
  "valencia": "Carabobo",
  "carabobo": "Carabobo",
  "aragua": "Aragua",
  "maracay": "Aragua",
  "lara": "Lara",
  "barquisimeto": "Lara",
  "anzoátegui": "Anzoátegui",
  "anzoategui": "Anzoátegui",
  "barcelona": "Anzoátegui",
  "puerto la cruz": "Anzoátegui",
  "bolívar": "Bolívar",
  "bolivar": "Bolívar",
  "margarita": "Nueva Esparta",
  "nueva esparta": "Nueva Esparta",
  "mérida": "Mérida",
  "merida": "Mérida",
  "táchira": "Táchira",
  "tachira": "Táchira",
  "falcon": "Falcón",
  "sucre": "Sucre",
  "la guaira": "La Guaira",
  "vargas": "La Guaira",
};

@Injectable()
export class LeadIntelligenceService {
  private readonly logger = new Logger(LeadIntelligenceService.name);

  constructor(
    private readonly ai: OpenRouterAdapter,
    private readonly bitrix24: Bitrix24Port,
  ) {}

  async updateLeadFromHistory(
    leadId: string,
    history: Array<{ role: "user" | "assistant"; content: string }>,
    contactName: string | null,
    vendorName: string,
  ): Promise<number> {
    this.logger.log(`updateLeadFromHistory called: leadId=${leadId}, historyLen=${history.length}, aiEnabled=${this.ai.isEnabled}`);

    if (!this.ai.isEnabled || history.length < 2) {
      this.logger.warn(`Skipping: ai=${this.ai.isEnabled}, historyLen=${history.length}`);
      return 0;
    }

    const extracted = await this.extractData(history);
    this.logger.log(`Extracted: ${JSON.stringify(extracted)}`);

    if (!extracted || extracted.camposLlenos < 3) {
      this.logger.warn(`Not enough data: camposLlenos=${extracted?.camposLlenos ?? 0}`);
      return 0;
    }

    this.logger.log(`Updating lead ${leadId} with ${extracted.camposLlenos} fields`);

    const commentLines: string[] = [];

    if (extracted.rubro) {
      const mapped = RUBRO_MAP[extracted.rubro.toLowerCase().trim()];
      commentLines.push(`Rubro: ${mapped ?? extracted.rubro}`);
    }
    if (extracted.estado || extracted.ciudad) {
      const loc = (extracted.estado ?? extracted.ciudad ?? "").toLowerCase().trim();
      const mapped = Object.entries(ESTADO_MAP).find(([k]) => loc.includes(k));
      commentLines.push(`Ubicación: ${mapped ? mapped[1] : (extracted.estado ?? extracted.ciudad)}`);
    }
    if (extracted.espacio) commentLines.push(`Espacio: ${extracted.espacio}`);
    if (extracted.producto) commentLines.push(`Producto: ${extracted.producto}`);
    if (extracted.medidas) commentLines.push(`Medidas: ${extracted.medidas}`);

    const existingLead = await this.bitrix24.getLead(leadId);
    const existingComments = existingLead ? "" : "";
    const now = new Date().toLocaleString("es-VE", { timeZone: "America/Caracas" });

    const titleParts: string[] = [];

    if (extracted.rubro) {
      const mapped = RUBRO_MAP[extracted.rubro.toLowerCase().trim()];
      titleParts.push(mapped ?? extracted.rubro);
    } else {
      titleParts.push("WhatsApp");
    }

    const name = contactName ?? "";
    if (name) titleParts.push(name);

    if (vendorName) titleParts.push(vendorName);

    const newTitle = titleParts.join(" / ");

    try {
      const updateFields: LeadUpdateFields = { statusId: "IN_PROCESS" };

      updateFields.title = newTitle;

      if (commentLines.length > 0) {
        updateFields.comments = `[Chatbot ${now}]\n${commentLines.join("\n")}`;
      }

      await this.bitrix24.updateLead(leadId, updateFields);
      this.logger.log(`Lead ${leadId} updated with ${extracted.camposLlenos} fields → IN_PROCESS`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to update lead ${leadId}: ${msg}`);
    }

    return extracted.camposLlenos;
  }

  private async extractData(
    history: Array<{ role: "user" | "assistant"; content: string }>,
  ): Promise<ExtractedData | null> {
    const userMessages = history
      .filter((t) => t.role === "user")
      .map((t) => t.content)
      .join("\n");

    const prompt = `Extrae del siguiente historial de conversación los datos del cliente. Responde SOLO con JSON válido, sin explicaciones.

{
  "rubro": "iluminación|mobiliario|domótica|redes|diseño de interiores|papel tapiz|paneles|ejecución de obra|null",
  "espacio": "sala|comedor|oficina|terraza|cocina|dormitorio|exterior|local comercial|null",
  "estado": "nombre del estado de Venezuela o null",
  "ciudad": "nombre de la ciudad o null",
  "medidas": "medidas mencionadas o null",
  "producto": "producto específico mencionado o null"
}

Conversación:
${userMessages}`;

    try {
      const response = await this.ai.chat([
        { role: "system", content: "Eres un extractor de datos. Responde solo JSON." },
        { role: "user", content: prompt },
      ]);

      if (!response) return null;

      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;

      const data = JSON.parse(jsonMatch[0]) as Record<string, string | null>;
      let camposLlenos = 0;

      const result: ExtractedData = { camposLlenos: 0 };
      if (data["rubro"]) { result.rubro = data["rubro"]!; camposLlenos++; }
      if (data["espacio"]) { result.espacio = data["espacio"]!; camposLlenos++; }
      if (data["estado"] || data["ciudad"]) camposLlenos++;
      if (data["estado"]) result.estado = data["estado"]!;
      if (data["ciudad"]) result.ciudad = data["ciudad"]!;
      if (data["medidas"]) { result.medidas = data["medidas"]!; camposLlenos++; }
      if (data["producto"]) { result.producto = data["producto"]!; camposLlenos++; }
      result.camposLlenos = camposLlenos;

      return result;
    } catch {
      return null;
    }
  }
}
