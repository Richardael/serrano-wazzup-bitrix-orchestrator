import { CatalogProduct, CatalogSearchResult } from "../../domain/catalog/catalog-product.entity";
import { CatalogSearchInput } from "../../domain/catalog/catalog.types";

export interface CatalogRepositoryPort {
  search(input: CatalogSearchInput): Promise<readonly CatalogSearchResult[]>;
  findBySlug(slug: string): Promise<CatalogProduct | null>;
  findByName(name: string): Promise<CatalogProduct | null>;
}
