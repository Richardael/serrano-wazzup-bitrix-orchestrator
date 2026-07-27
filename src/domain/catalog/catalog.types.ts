import { z } from "zod";

export const CatalogSearchInputSchema = z.object({
  query: z.string().trim().min(1).max(300),
  category: z.string().trim().max(100).optional(),
  configuration: z.string().trim().max(100).optional(),
  material: z.string().trim().max(100).optional(),
  seats: z.number().int().positive().max(20).optional(),
  limit: z.number().int().min(1).max(5).default(5),
});

export type CatalogSearchInput = z.infer<typeof CatalogSearchInputSchema>;

export function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
