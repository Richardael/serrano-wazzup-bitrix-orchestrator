import { Injectable, Inject } from "@nestjs/common";
import { CatalogRepositoryPort } from "../../ports/catalog-repository.port";
import { CatalogProductDetails } from "../../../domain/catalog/catalog-product.entity";

@Injectable()
export class GetProductDetailsUseCase {
  constructor(@Inject("CATALOG_REPOSITORY") private readonly catalogRepo: CatalogRepositoryPort) {}

  async execute(slug: string): Promise<CatalogProductDetails | null> {
    const product = await this.catalogRepo.findBySlug(slug);
    if (!product) return null;

    const images: { productId: string; isPrimary: boolean; publicUrl: string | null }[] = [];

    return {
      id: product.id,
      slug: product.slug,
      name: product.name,
      category: product.category,
      shortDescription: product.shortDescription,
      configurations: product.configurations,
      materials: product.materials,
      finishes: product.finishes,
      sizes: product.sizes,
      seatOptions: product.seatOptions,
      sourcePages: product.sourcePages,
      primaryImageUrl: images.find((i) => i.isPrimary)?.publicUrl ?? null,
      needsReview: product.needsReview,
    };
  }
}
