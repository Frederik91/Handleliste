import type { RecipePreviewLine, Recipe } from "./recipe.js";

export interface RecipeSelectionInput { recipeId: number; count: number }
export interface SelectedRecipe extends RecipeSelectionInput {
  name: string;
  requirements: Recipe["requirements"];
}
export interface RecipeDemand extends RecipePreviewLine {
  baseline: number;
  supply: number;
  clearedPurchased: number;
  contributions: Array<{ recipeId: number; name: string; count: number; amount: number }>;
}
export interface ItemRecipeSources { baseline: number; generated: number }
