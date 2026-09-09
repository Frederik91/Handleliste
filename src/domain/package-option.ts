import type { MeasurementDimension, PackageUnit } from "./shopping-list.js";

export const packageUnits = ["unit", "piece", "g", "kg", "ml", "cl", "dl", "L", "tsp", "tbsp"] as const;

export function isPackageUnit(value: unknown): value is PackageUnit {
  return typeof value === "string" && (packageUnits as readonly string[]).includes(value);
}

export function measurementDimensionFor(unit: PackageUnit): MeasurementDimension {
  if (unit === "g" || unit === "kg") return "mass";
  if (unit === "ml" || unit === "cl" || unit === "dl" || unit === "L" || unit === "tsp" || unit === "tbsp") {
    return "volume";
  }
  return "count";
}
