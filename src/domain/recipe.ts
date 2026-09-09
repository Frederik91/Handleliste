import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import { measurementDimensionFor } from "./package-option.js";
import type { MeasurementDimension } from "./shopping-list.js";

export const positiveIntegerSchema = Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER });
export const recipeUnitSchema = Type.Union([
  Type.Literal("g"), Type.Literal("kg"), Type.Literal("ml"), Type.Literal("cl"),
  Type.Literal("dl"), Type.Literal("L"), Type.Literal("tsp"), Type.Literal("tbsp"),
  Type.Literal("piece"),
]);
export const canonicalRecipeUnitSchema = Type.Union([
  Type.Literal("g"), Type.Literal("ml"), Type.Literal("piece"),
]);
export const recipeUnits = recipeUnitSchema.anyOf.map((unit) => unit.const);
export type RecipeUnit = Static<typeof recipeUnitSchema>;

export const ingredientRequirementSchema = Type.Object({
  amount: Type.Number({ exclusiveMinimum: 0 }),
  productId: positiveIntegerSchema,
  unit: recipeUnitSchema,
});
export type IngredientRequirement = Static<typeof ingredientRequirementSchema>;

export const recipeInputSchema = Type.Object({
  name: Type.String({ minLength: 1, pattern: ".*\\S.*" }),
  note: Type.Optional(Type.String()),
  requirements: Type.Array(ingredientRequirementSchema, { minItems: 1 }),
});
export type RecipeInput = Static<typeof recipeInputSchema>;
export const recipeSchema = Type.Object({
  ...recipeInputSchema.properties,
  archived: Type.Boolean(),
  id: positiveIntegerSchema,
});
export type Recipe = Static<typeof recipeSchema>;

export const recipePreviewLineSchema = Type.Object({
  amount: Type.Number({ exclusiveMinimum: 0 }),
  productId: positiveIntegerSchema,
  unit: canonicalRecipeUnitSchema,
});
export type RecipePreviewLine = Static<typeof recipePreviewLineSchema>;
export const recipePreviewSchema = Type.Object({
  count: positiveIntegerSchema,
  lines: Type.Array(recipePreviewLineSchema),
  recipeId: positiveIntegerSchema,
});
export type RecipePreview = Static<typeof recipePreviewSchema>;

export function isRecipeUnit(value: string): value is RecipeUnit {
  return Value.Check(recipeUnitSchema, value);
}

export function recipeUnitDimension(unit: RecipeUnit): MeasurementDimension {
  return measurementDimensionFor(unit);
}
