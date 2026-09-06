import {
  recipeUnitDimension,
  type IngredientRequirement,
  type RecipePreviewLine,
  type RecipeUnit,
} from "../domain/recipe.js";
import type { MeasurementDimension } from "../domain/shopping-list.js";

const canonicalUnit = {
  count: "piece",
  mass: "g",
  volume: "ml",
} as const satisfies Record<MeasurementDimension, RecipePreviewLine["unit"]>;

const canonicalFactor = {
  L: 1000,
  cl: 10,
  dl: 100,
  g: 1,
  kg: 1000,
  ml: 1,
  piece: 1,
  tbsp: 15,
  tsp: 5,
} as const satisfies Record<RecipeUnit, number>;

export class RecipeMeasurementError extends Error {}

export function calculateRecipePreview(
  requirements: readonly IngredientRequirement[],
  count: number,
): RecipePreviewLine[] {
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
      amount: (current?.amount ?? 0) + requirement.amount * canonicalFactor[requirement.unit] * count,
      dimension,
    });
  }

  return [...totals.entries()].map(([productId, total]) => ({
    amount: total.amount,
    productId,
    unit: canonicalUnit[total.dimension],
  }));
}
