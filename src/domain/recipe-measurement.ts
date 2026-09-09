import { recipeUnitDimension, type IngredientRequirement, type RecipePreviewLine } from "./recipe.js";
import { measurementDimensionFor } from "./package-option.js";
import type { MeasurementDimension, PackageUnit } from "./shopping-list.js";

const canonicalUnits: Record<MeasurementDimension, RecipePreviewLine["unit"]> = {
  count: "piece", mass: "g", volume: "ml",
};
const conversionFactors: Record<PackageUnit, number> = {
  L: 1000, cl: 10, dl: 100, g: 1, kg: 1000, ml: 1, piece: 1, tbsp: 15, tsp: 5, unit: 1,
};

export function canonicalUnitFor(unit: PackageUnit): RecipePreviewLine["unit"] {
  return canonicalUnits[measurementDimensionFor(unit)];
}

export function canonicalAmount({ amount, unit }: { amount: number; unit: PackageUnit }): number {
  return amount * conversionFactors[unit];
}

export class RecipeMeasurementError extends Error {}

export function calculateRecipePreview({ requirements, count }: {
  requirements: readonly IngredientRequirement[];
  count: number;
}): RecipePreviewLine[] {
  if (!Number.isSafeInteger(count) || count < 1) {
    throw new RecipeMeasurementError("Recipe count must be a positive whole number");
  }
  const totals = new Map<number, { amount: number; dimension: MeasurementDimension }>();
  for (const requirement of requirements) {
    if (!Number.isFinite(requirement.amount) || requirement.amount <= 0) {
      throw new RecipeMeasurementError("Ingredient amount must be positive");
    }
    const dimension = recipeUnitDimension(requirement.unit);
    const current = totals.get(requirement.productId);
    if (current && current.dimension !== dimension) {
      throw new RecipeMeasurementError("A Product cannot use incompatible dimensions in one Recipe");
    }
    totals.set(requirement.productId, {
      amount: (current?.amount ?? 0) + canonicalAmount(requirement) * count,
      dimension,
    });
  }
  return [...totals.entries()].map(([productId, total]) => ({
    amount: total.amount,
    productId,
    unit: canonicalUnits[total.dimension],
  }));
}
