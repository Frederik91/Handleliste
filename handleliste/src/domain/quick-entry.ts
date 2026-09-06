import { measurementDimensionFor } from "./package-option.js";
import type { MeasurementDimension, PackageUnit, ShoppingListMutation } from "./shopping-list.js";

export interface ParsedQuickEntry {
  packageOption?: {
    measurementDimension: MeasurementDimension;
    size: number;
    unit: PackageUnit;
  };
  productName: string;
  quantity: number;
}

export interface QuickEntryInput {
  entry: string;
  productId?: number;
}

export interface QuickEntryRepository {
  addParsedQuickEntry(entry: ParsedQuickEntry, productId?: number): ShoppingListMutation;
}

export class AddQuickEntryCommand {
  constructor(private readonly repository: QuickEntryRepository) {}

  execute(input: QuickEntryInput): ShoppingListMutation {
    return this.repository.addParsedQuickEntry(parseQuickEntry(input.entry), input.productId);
  }
}

const unitAliases: Readonly<Record<string, PackageUnit>> = {
  g: "g", gram: "g", grams: "g",
  kg: "kg", kilogram: "kg", kilograms: "kg",
  ml: "ml", milliliter: "ml", milliliters: "ml", millilitre: "ml", millilitres: "ml",
  cl: "cl", centiliter: "cl", centiliters: "cl", centilitre: "cl", centilitres: "cl",
  dl: "dl", deciliter: "dl", deciliters: "dl", decilitre: "dl", decilitres: "dl",
  l: "L", liter: "L", liters: "L", litre: "L", litres: "L",
  tsp: "tsp", teaspoon: "tsp", teaspoons: "tsp",
  tbsp: "tbsp", tablespoon: "tbsp", tablespoons: "tbsp",
  piece: "piece", pieces: "piece", pc: "piece", pcs: "piece",
};

export function parseQuickEntry(rawEntry: string): ParsedQuickEntry {
  const completeName = normalizeWhitespace(rawEntry);
  let candidate = completeName;
  let quantity = 1;
  let hadLeadingCount = false;

  const counted = candidate.match(/^(\d+)\s*(?:x|×)\s+(.+)$/i);
  if (counted) {
    const parsedCount = Number(counted[1]);
    if (parsedCount < 1) {
      return { productName: completeName, quantity: 1 };
    }
    quantity = parsedCount;
    candidate = counted[2]!;
    hadLeadingCount = true;
  }

  const sized = candidate.match(/^(.+?\S)\s+(\d+(?:[.,]\d+)?)\s*([a-zA-Z]+)$/);
  if (sized) {
    const unit = unitAliases[sized[3]!.toLocaleLowerCase("en")];
    const size = Number(sized[2]!.replace(",", "."));
    if (unit && size > 0) {
      if (!hadLeadingCount) {
        const plainCount = sized[1]!.match(/^(\d+)\s+(.+)$/);
        if (plainCount && Number(plainCount[1]) > 0) {
          quantity = Number(plainCount[1]);
          candidate = plainCount[2]!;
        } else {
          candidate = sized[1]!;
        }
      } else {
        candidate = sized[1]!;
      }
      return {
        packageOption: { measurementDimension: measurementDimensionFor(unit), size, unit },
        productName: normalizeWhitespace(candidate),
        quantity,
      };
    }
  }

  if (hadLeadingCount && !looksLikeUnsupportedSize(candidate)) {
    return { productName: candidate, quantity };
  }
  return { productName: completeName, quantity: 1 };
}

function looksLikeUnsupportedSize(value: string): boolean {
  return /\d(?:[.,]\d+)?\s*[a-zA-Z]+$/.test(value);
}

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}
