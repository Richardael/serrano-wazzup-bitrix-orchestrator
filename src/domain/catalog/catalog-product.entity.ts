export interface CatalogProduct {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly normalizedName: string;
  readonly category: string;
  readonly shortDescription: string | null;
  readonly searchText: string;
  readonly aliases: readonly string[];
  readonly configurations: readonly string[];
  readonly materials: readonly string[];
  readonly finishes: readonly string[];
  readonly sizes: readonly string[];
  readonly seatOptions: readonly string[];
  readonly sourcePages: readonly number[];
  readonly keywords: readonly string[];
  readonly isActive: boolean;
  readonly needsReview: boolean;
}

export interface CatalogSearchResult {
  readonly productId: string;
  readonly slug: string;
  readonly name: string;
  readonly category: string;
  readonly matchedFacts: readonly string[];
  readonly sourcePages: readonly number[];
  readonly score: number;
}

export interface CatalogProductDetails {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly category: string;
  readonly shortDescription: string | null;
  readonly configurations: readonly string[];
  readonly materials: readonly string[];
  readonly finishes: readonly string[];
  readonly sizes: readonly string[];
  readonly seatOptions: readonly string[];
  readonly sourcePages: readonly number[];
  readonly primaryImageUrl: string | null;
  readonly needsReview: boolean;
}
