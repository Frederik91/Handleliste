import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import { itemRecipeSourcesSchema, recipeDemandSchema, selectedRecipeSchema } from "./recipe-planning.js";
import { positiveIntegerSchema, recipeSchema, recipeUnitSchema } from "./recipe.js";

export const packageUnitSchema = Type.Union([Type.Literal("unit"), ...recipeUnitSchema.anyOf]);
export type PackageUnit = Static<typeof packageUnitSchema>;
export const measurementDimensionSchema = Type.Union([
  Type.Literal("count"), Type.Literal("mass"), Type.Literal("volume"),
]);
export type MeasurementDimension = Static<typeof measurementDimensionSchema>;

const packageOptionSchema = Type.Object({
  id: positiveIntegerSchema,
  isDefault: Type.Boolean(),
  measurementDimension: measurementDimensionSchema,
  size: Type.Number({ exclusiveMinimum: 0 }),
  unit: packageUnitSchema,
});
export type PackageOption = Static<typeof packageOptionSchema>;
const productIdentitySchema = Type.Object({ id: positiveIntegerSchema, name: Type.String() });
const productSchema = Type.Object({
  ...productIdentitySchema.properties,
  packageOptions: Type.Array(packageOptionSchema),
});
export type Product = Static<typeof productSchema>;
const shoppingListItemSchema = Type.Object({
  recipeSources: itemRecipeSourcesSchema,
  id: positiveIntegerSchema,
  packageOption: packageOptionSchema,
  product: productIdentitySchema,
  quantity: positiveIntegerSchema,
  state: Type.Union([
    Type.Object({ kind: Type.Literal("active"), position: positiveIntegerSchema }),
    Type.Object({ kind: Type.Literal("completed"), completedAt: Type.Number() }),
  ]),
});
export type ShoppingListItem = Static<typeof shoppingListItemSchema>;

const alwaysInStockDefinitionInputSchema = Type.Object({
  defaultQuantity: positiveIntegerSchema,
  packageOptionId: positiveIntegerSchema,
  productId: positiveIntegerSchema,
});
export type AlwaysInStockDefinitionInput = Static<typeof alwaysInStockDefinitionInputSchema>;
const alwaysInStockDefinitionSchema = Type.Object({
  ...alwaysInStockDefinitionInputSchema.properties,
  archived: Type.Boolean(),
  id: positiveIntegerSchema,
  position: positiveIntegerSchema,
});
export type AlwaysInStockDefinition = Static<typeof alwaysInStockDefinitionSchema>;
const alwaysInStockSelectionSchema = Type.Object({
  definitionId: positiveIntegerSchema,
  quantity: positiveIntegerSchema,
});
export type AlwaysInStockSelection = Static<typeof alwaysInStockSelectionSchema>;
export type AlwaysInStockSelectionInput = AlwaysInStockSelection;

export const shoppingListSnapshotSchema = Type.Object({
  alwaysInStockDefinitions: Type.Array(alwaysInStockDefinitionSchema),
  alwaysInStockSelections: Type.Array(alwaysInStockSelectionSchema),
  items: Type.Array(shoppingListItemSchema),
  products: Type.Array(productSchema),
  recipes: Type.Array(recipeSchema),
  selectedRecipes: Type.Array(selectedRecipeSchema),
  recipeDemands: Type.Array(recipeDemandSchema),
  revision: Type.Integer({ minimum: 0 }),
});
export type ShoppingListSnapshot = Static<typeof shoppingListSnapshotSchema>;
export const shoppingListMutationSchema = Type.Object({
  ...shoppingListSnapshotSchema.properties,
  undoToken: Type.String(),
});
export type ShoppingListMutation = Static<typeof shoppingListMutationSchema>;

export function parseShoppingListSnapshot(value: unknown): ShoppingListSnapshot {
  return Value.Parse(shoppingListSnapshotSchema, value);
}

export interface ShoppingItemEdit {
  itemId: number;
  packageSize: number;
  packageUnit: PackageUnit;
  productId?: number;
  productName: string;
  quantity: number;
}
