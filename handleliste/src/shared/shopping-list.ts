export type PackageUnit = "unit";

export interface ShoppingListItem {
  id: number;
  packageOption: {
    id: number;
    size: number;
    unit: PackageUnit;
  };
  product: {
    id: number;
    name: string;
  };
  quantity: number;
}

export interface ShoppingListSnapshot {
  items: ShoppingListItem[];
  revision: number;
}
