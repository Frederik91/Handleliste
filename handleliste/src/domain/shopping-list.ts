import type { Recipe } from "./recipe.js";
export type PackageUnit = "unit" | "piece" | "g" | "kg" | "ml" | "cl" | "dl" | "L" | "tsp" | "tbsp";

export type MeasurementDimension = "count" | "mass" | "volume";

export interface PackageOption {
  id: number;
  isDefault: boolean;
  measurementDimension: MeasurementDimension;
  size: number;
  unit: PackageUnit;
}

export interface Product {
  id: number;
  name: string;
  packageOptions: PackageOption[];
}

interface ShoppingListItemBase {
  id: number;
  packageOption: PackageOption;
  product: Pick<Product, "id" | "name">;
  quantity: number;
}

export type ShoppingListItem = ShoppingListItemBase & (
  | { state: { kind: "active"; position: number } }
  | { state: { completedAt: number; kind: "completed" } }
);

export interface AlwaysInStockDefinition {
  archived: boolean;
  defaultQuantity: number;
  id: number;
  packageOptionId: number;
  position: number;
  productId: number;
}

export interface AlwaysInStockSelection {
  definitionId: number;
  quantity: number;
}

export interface AlwaysInStockDefinitionInput {
  defaultQuantity: number;
  packageOptionId: number;
  productId: number;
}

export interface AlwaysInStockSelectionInput {
  definitionId: number;
  quantity: number;
}

export interface ShoppingListSnapshot {
  alwaysInStockDefinitions: AlwaysInStockDefinition[];
  alwaysInStockSelections: AlwaysInStockSelection[];
  items: ShoppingListItem[];
  products: Product[];
  recipes: Recipe[];
  revision: number;
}

export interface ShoppingListMutation extends ShoppingListSnapshot {
  undoToken: string;
}

export interface ShoppingItemEdit {
  itemId: number;
  packageSize: number;
  packageUnit: PackageUnit;
  productId?: number;
  productName: string;
  quantity: number;
}
