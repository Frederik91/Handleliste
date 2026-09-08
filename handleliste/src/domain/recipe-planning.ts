import { Type, type Static } from "typebox";
import { positiveIntegerSchema, recipeInputSchema, recipePreviewLineSchema } from "./recipe.js";

export const recipeSelectionInputSchema = Type.Object({
  recipeId: positiveIntegerSchema,
  count: positiveIntegerSchema,
});
export type RecipeSelectionInput = Static<typeof recipeSelectionInputSchema>;
export const selectedRecipeSchema = Type.Object({
  ...recipeSelectionInputSchema.properties,
  name: recipeInputSchema.properties.name,
  requirements: recipeInputSchema.properties.requirements,
});
export type SelectedRecipe = Static<typeof selectedRecipeSchema>;
export const recipeDemandSchema = Type.Object({
  ...recipePreviewLineSchema.properties,
  baseline: Type.Number({ minimum: 0 }),
  supply: Type.Number({ minimum: 0 }),
  clearedPurchased: Type.Number({ minimum: 0 }),
  contributions: Type.Array(Type.Object({
    ...recipeSelectionInputSchema.properties,
    name: recipeInputSchema.properties.name,
    amount: recipePreviewLineSchema.properties.amount,
  })),
});
export type RecipeDemand = Static<typeof recipeDemandSchema>;
export const itemRecipeSourcesSchema = Type.Object({
  baseline: Type.Integer({ minimum: 0 }),
  generated: Type.Integer({ minimum: 0 }),
});
export type ItemRecipeSources = Static<typeof itemRecipeSourcesSchema>;
