import { Injectable } from "@nestjs/common";
import { eq, and, sql, or, ilike } from "drizzle-orm";
import { drizzle, PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { AppConfig } from "../../config/app.config";
import * as schema from "../../database/schema";
import { CatalogRepositoryPort } from "../../../application/ports/catalog-repository.port";
import { CatalogProduct, CatalogSearchResult } from "../../../domain/catalog/catalog-product.entity";
import { CatalogSearchInput } from "../../../domain/catalog/catalog.types";
import { normalizeSearchText } from "../../../domain/catalog/catalog.types";

@Injectable()
export class DrizzleCatalogRepository implements CatalogRepositoryPort {
  private db: PostgresJsDatabase<typeof schema>;

  constructor(config: AppConfig) {
    const client = postgres(config.env.DATABASE_URL);
    this.db = drizzle(client, { schema });
  }

  async search(input: CatalogSearchInput): Promise<readonly CatalogSearchResult[]> {
    const query = normalizeSearchText(input.query);
    const results: CatalogSearchResult[] = [];

    const dbProducts = await this.db
      .select()
      .from(schema.catalogProducts)
      .where(eq(schema.catalogProducts.isActive, true));

    for (const p of dbProducts) {
      const matchedFacts: string[] = [];
      let score = 0;

      const nameNorm = normalizeSearchText(p.name);
      const searchText = p.searchText;

      if (nameNorm === query) {
        score += 100;
        matchedFacts.push("exact-name");
      }

      if (p.aliases && Array.isArray(p.aliases)) {
        const aliasMatch = (p.aliases as string[]).some(
          (a) => normalizeSearchText(a) === query || searchText.includes(normalizeSearchText(a)),
        );
        if (aliasMatch) {
          score += 80;
          matchedFacts.push("alias-match");
        }
      }

      if (input.category && normalizeSearchText(p.category) === normalizeSearchText(input.category)) {
        score += 50;
        matchedFacts.push("category-exact");
      }

      if (input.configuration && p.configurations && Array.isArray(p.configurations)) {
        const configMatch = (p.configurations as string[]).some(
          (c) => normalizeSearchText(c) === normalizeSearchText(input.configuration!),
        );
        if (configMatch) {
          score += 40;
          matchedFacts.push("config-exact");
        }
      }

      if (input.seats && p.seatOptions && Array.isArray(p.seatOptions)) {
        const seatMatch = (p.seatOptions as number[]).includes(input.seats);
        if (seatMatch) {
          score += 35;
          matchedFacts.push("seats-match");
        }
      }

      if (input.material && p.materials && Array.isArray(p.materials)) {
        const matMatch = (p.materials as string[]).some(
          (m) => normalizeSearchText(m).includes(normalizeSearchText(input.material!)),
        );
        if (matMatch) {
          score += 25;
          matchedFacts.push("material-match");
        }
      }

      if (p.keywords && Array.isArray(p.keywords)) {
        const kwMatch = (p.keywords as string[]).some((kw) => query.includes(normalizeSearchText(kw)));
        if (kwMatch) {
          score += 15;
          matchedFacts.push("keyword-match");
        }
      }

      if (searchText.includes(query)) {
        score += 10;
        matchedFacts.push("partial-match");
      }

      if (p.needsReview) {
        score -= 30;
      }

      if (score > 0) {
        results.push({
          productId: p.id,
          slug: p.slug,
          name: p.name,
          category: p.category,
          matchedFacts,
          sourcePages: (p.sourcePages as number[]) ?? [],
          score,
        });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, input.limit);
  }

  async findBySlug(slug: string): Promise<CatalogProduct | null> {
    const rows = await this.db
      .select()
      .from(schema.catalogProducts)
      .where(eq(schema.catalogProducts.slug, slug))
      .limit(1);

    if (!rows[0]) return null;
    return this.toDomain(rows[0]);
  }

  async findByName(name: string): Promise<CatalogProduct | null> {
    const norm = normalizeSearchText(name);
    const rows = await this.db
      .select()
      .from(schema.catalogProducts)
      .where(eq(schema.catalogProducts.normalizedName, norm))
      .limit(1);

    if (!rows[0]) return null;
    return this.toDomain(rows[0]);
  }

  private toDomain(row: typeof schema.catalogProducts.$inferSelect): CatalogProduct {
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      normalizedName: row.normalizedName,
      category: row.category,
      shortDescription: row.shortDescription,
      searchText: row.searchText,
      aliases: (row.aliases as string[]) ?? [],
      configurations: (row.configurations as string[]) ?? [],
      materials: (row.materials as string[]) ?? [],
      finishes: (row.finishes as string[]) ?? [],
      sizes: (row.sizes as string[]) ?? [],
      seatOptions: (row.seatOptions as string[]) ?? [],
      sourcePages: (row.sourcePages as number[]) ?? [],
      keywords: (row.keywords as string[]) ?? [],
      isActive: row.isActive,
      needsReview: row.needsReview,
    };
  }
}
