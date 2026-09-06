import type { MeasurementDimension } from "./shopping-list.js";

export const recipeUnits = ["g", "kg", "ml", "cl", "dl", "L", "tsp", "tbsp", "piece"] as const;

export type RecipeUnit = typeof recipeUnits[number];

export interface IngredientRequirement {
  amount: number;
  productId: number;
  unit: RecipeUnit;
}

export interface Recipe {
  archived: boolean;
  id: number;
  name: string;
  note?: string;
  requirements: IngredientRequirement[];
}

export interface RecipeInput {
  name: string;
  note?: string;
  requirements: IngredientRequirement[];
}

export interface RecipePreviewLine {
  amount: number;
  productId: number;
  unit: "g" | "ml" | "piece";
}

export interface RecipePreview {
  count: number;
  lines: RecipePreviewLine[];
  recipeId: number;
}

export function isRecipeUnit(value: string): value is RecipeUnit {
  return (recipeUnits as readonly string[]).includes(value);
}

export function recipeUnitDimension(unit: RecipeUnit): MeasurementDimension {
  if (unit === "g" || unit === "kg") return "mass";
  if (unit === "piece") return "count";
  return "volume";
}
