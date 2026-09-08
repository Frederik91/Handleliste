import { Type, type Static } from "typebox";
import { ingredientRequirementSchema, positiveIntegerSchema } from "../../domain/recipe.js";
import type { MeasurementDimension, PackageUnit } from "../../domain/shopping-list.js";

export interface ProductRow {
  id: number;
  name: string;
}

export interface PackageOptionRow {
  id: number;
  is_default: number;
  measurement_dimension: MeasurementDimension;
  product_id: number;
  size: number;
  unit: PackageUnit;
}

export interface AlwaysInStockDefinitionRow {
  archived: number;
  default_quantity: number;
  id: number;
  package_option_id: number;
  position: number;
  product_id: number;
}

export const recipeRowSchema = Type.Object({
  archived: Type.Union([Type.Literal(0), Type.Literal(1)]),
  id: positiveIntegerSchema,
  name: Type.String(),
  note: Type.Union([Type.String(), Type.Null()]),
});
export type RecipeRow = Static<typeof recipeRowSchema>;
export const recipeRequirementRowSchema = Type.Object({
  recipe_id: positiveIntegerSchema,
  product_id: ingredientRequirementSchema.properties.productId,
  amount: ingredientRequirementSchema.properties.amount,
  unit: ingredientRequirementSchema.properties.unit,
});
