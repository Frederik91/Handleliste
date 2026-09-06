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
