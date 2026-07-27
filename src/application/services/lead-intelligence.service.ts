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

const RUBRO_MAP: Record<string, number> = {
  "iluminación": 282,
  "iluminacion": 282,
  "mobiliario": 284,
  "domótica": 286,
  "domotica": 286,
  "redes": 288,
  "diseño de interiores": 290,
  "diseño interior": 290,
  "papel tapiz": 294,
  "papel": 294,
  "paneles": 296,
  "ejecución de obra": 292,
  "ejecucion de obra": 292,
};

const ESTADO_MAP: Record<string, number> = {
  "amazonas": 232,
  "anzoátegui": 234,
  "anzoategui": 234,
  "puerto la cruz": 234,
  "barcelona": 234,
  "apure": 236,
  "aragua": 238,
  "maracay": 238,
  "barinas": 240,
  "bolívar": 242,
  "bolivar": 242,
  "carabobo": 244,
  "valencia": 244,
  "cojedes": 246,
  "delta amacuro": 248,
  "falcón": 250,
  "falcon": 250,
  "guárico": 252,
  "guarico": 252,
  "lara": 254,
  "barquisimeto": 254,
  "la guaira": 256,
  "vargas": 256,
  "mérida": 258,
  "merida": 258,
  "miranda": 260,
  "monagas": 262,
  "nueva esparta": 264,
  "margarita": 264,
  "portuguesa": 266,
  "sucre": 268,
  "táchira": 270,
  "tachira": 270,
  "trujillo": 272,
  "yaracuy": 274,
  "zulia": 276,
  "maracaibo": 276,
  "distrito capital": 278,
  "caracas": 278,
  "dependencias federales": 280,
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
    const extraParams: Record<string, string> = {};

    if (extracted.rubro) {
      const id = RUBRO_MAP[extracted.rubro.toLowerCase().trim()];
      if (id) extraParams["fields[UF_CRM_RUBRO]"] = String(id);
    }

    if (extracted.estado || extracted.ciudad) {
      const loc = (extracted.estado ?? extracted.ciudad ?? "").toLowerCase().trim();
      const entry = Object.entries(ESTADO_MAP).find(([k]) => loc.includes(k));
      const id = entry?.[1];
      if (id !== undefined) extraParams["fields[UF_CRM_ESTADO_VENEZUELA]"] = String(id);
      else commentLines.push(`Ubicación: ${extracted.estado ?? extracted.ciudad}`);
    }

    if (extracted.espacio) commentLines.push(`Espacio: ${extracted.espacio}`);
    if (extracted.producto) commentLines.push(`Producto: ${extracted.producto}`);
    if (extracted.medidas) commentLines.push(`Medidas: ${extracted.medidas}`);

    const existingLead = await this.bitrix24.getLead(leadId);
    const existingComments = existingLead ? "" : "";
    const now = new Date().toLocaleString("es-VE", { timeZone: "America/Caracas" });

    const titleParts: string[] = [];

    if (extracted.rubro) {
      titleParts.push(extracted.rubro);
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

      if (Object.keys(extraParams).length > 0) {
        updateFields.extraParams = extraParams;
      }

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
