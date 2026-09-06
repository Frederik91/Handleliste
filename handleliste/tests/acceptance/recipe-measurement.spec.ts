import { expect, test } from "@playwright/test";
import { calculateRecipePreview, RecipeMeasurementError } from "../../src/domain/recipe-measurement.js";

test("converts every supported Recipe unit to its canonical dimension", () => {
  const lines = calculateRecipePreview([
    { amount: 2, productId: 1, unit: "kg" },
    { amount: 3, productId: 1, unit: "g" },
    { amount: 1, productId: 2, unit: "L" },
    { amount: 2, productId: 2, unit: "dl" },
    { amount: 3, productId: 2, unit: "cl" },
    { amount: 4, productId: 2, unit: "ml" },
    { amount: 5, productId: 2, unit: "tsp" },
    { amount: 6, productId: 2, unit: "tbsp" },
    { amount: 7, productId: 3, unit: "piece" },
  ], 2);

  expect(lines).toEqual([
    { amount: 4006, productId: 1, unit: "g" },
    { amount: 2698, productId: 2, unit: "ml" },
    { amount: 14, productId: 3, unit: "piece" },
  ]);
});

test("does not combine a Product across measurement dimensions", () => {
  expect(() => calculateRecipePreview([
    { amount: 1, productId: 1, unit: "g" },
    { amount: 1, productId: 1, unit: "ml" },
  ], 1)).toThrow(new RecipeMeasurementError("A Product cannot use incompatible dimensions in one Recipe"));
});
