import { z } from "zod";

export const ConversationPlanSchema = z.object({
  intent: z.enum([
    "GREETING",
    "CATALOG_DISCOVERY",
    "PRODUCT_SEARCH",
    "PRODUCT_DETAILS",
    "PRICE_REQUEST",
    "AVAILABILITY_REQUEST",
    "QUOTE_REQUEST",
    "VISIT_REQUEST",
    "HUMAN_REQUEST",
    "PROJECT_DISCOVERY",
    "UNRELATED",
  ]),
  extractedFacts: z.object({
    customerName: z.string().nullable(),
    productCategory: z.string().nullable(),
    productNames: z.array(z.string()),
    spaceType: z.string().nullable(),
    state: z.string().nullable(),
    city: z.string().nullable(),
    measurements: z.string().nullable(),
    seats: z.number().int().positive().nullable(),
    preferredConfiguration: z.string().nullable(),
    preferredMaterials: z.array(z.string()),
  }),
  catalogAction: z.enum(["NONE", "SEARCH", "DETAILS"]),
  catalogQuery: z.string().nullable(),
  nextQuestionPurpose: z.string().nullable(),
  handoffRequired: z.boolean(),
  handoffReason: z.string().nullable(),
});

export type ConversationPlan = z.infer<typeof ConversationPlanSchema>;

export const HANDOFF_INTENTS = new Set([
  "PRICE_REQUEST",
  "AVAILABILITY_REQUEST",
  "QUOTE_REQUEST",
  "VISIT_REQUEST",
  "HUMAN_REQUEST",
] as const);
