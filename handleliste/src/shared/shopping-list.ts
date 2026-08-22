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

export interface ShoppingListItem {
  id: number;
  packageOption: PackageOption;
  product: Pick<Product, "id" | "name">;
  quantity: number;
}

export interface ShoppingListSnapshot {
  items: ShoppingListItem[];
  products: Product[];
  revision: number;
}

export interface ShoppingListMutation extends ShoppingListSnapshot {
  undoToken?: string;
}

export interface ShoppingItemEdit {
  itemId: number;
  packageSize: number;
  packageUnit: PackageUnit;
  productId?: number;
  productName: string;
  quantity: number;
}
