import { Injectable } from "@nestjs/common";
import { CatalogRepositoryPort } from "../../ports/catalog-repository.port";
import { CatalogSearchInput, CatalogSearchInputSchema } from "../../../domain/catalog/catalog.types";
import { CatalogSearchResult } from "../../../domain/catalog/catalog-product.entity";

@Injectable()
export class SearchCatalogUseCase {
  constructor(private readonly catalogRepo: CatalogRepositoryPort) {}

  async execute(rawInput: Record<string, unknown>): Promise<readonly CatalogSearchResult[]> {
    const input = CatalogSearchInputSchema.parse(rawInput);
    return this.catalogRepo.search(input);
  }
}
