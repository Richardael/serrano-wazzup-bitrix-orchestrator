import { describe, it, expect } from "vitest";
import { normalizeSearchText, CatalogSearchInputSchema } from "../../src/domain/catalog/catalog.types";

describe("normalizeSearchText", () => {
  it("lowercases", () => {
    expect(normalizeSearchText("Sofá Verona")).toBe("sofa verona");
  });

  it("removes accents", () => {
    expect(normalizeSearchText("Iluminación")).toBe("iluminacion");
  });

  it("normalizes spaces", () => {
    expect(normalizeSearchText("  sofa   verona  ")).toBe("sofa verona");
  });

  it("handles empty string", () => {
    expect(normalizeSearchText("")).toBe("");
  });

  it("handles special chars", () => {
    expect(normalizeSearchText("sofá-cama")).toBe("sofa-cama");
  });
});

describe("CatalogSearchInputSchema", () => {
  it("validates minimal input", () => {
    const result = CatalogSearchInputSchema.safeParse({ query: "sofa" });
    expect(result.success).toBe(true);
  });

  it("rejects empty query", () => {
    const result = CatalogSearchInputSchema.safeParse({ query: "" });
    expect(result.success).toBe(false);
  });

  it("rejects query over 300 chars", () => {
    const result = CatalogSearchInputSchema.safeParse({ query: "a".repeat(301) });
    expect(result.success).toBe(false);
  });

  it("validates with optional fields", () => {
    const result = CatalogSearchInputSchema.safeParse({
      query: "sofa",
      category: "sofas",
      seats: 3,
    });
    expect(result.success).toBe(true);
  });
});
