import { Type } from "typebox";
import { Value } from "typebox/value";
import type { DatabaseSync } from "node:sqlite";
import { calculateRecipePreview } from "../domain/recipe-measurement.js";
import type { Recipe } from "../domain/recipe.js";
import type { RecipeDemand, RecipeSelectionInput, SelectedRecipe, ItemRecipeSources } from "../domain/recipe-planning.js";
import type { PackageUnit } from "../domain/shopping-list.js";

const selectionSchema = Type.Array(Type.Object({
  recipeId: Type.Integer(), count: Type.Integer({ minimum: 1 }), name: Type.String(),
  requirements: Type.Array(Type.Object({ productId: Type.Integer(), amount: Type.Number(),
    unit: Type.Union([Type.Literal("g"), Type.Literal("kg"), Type.Literal("ml"), Type.Literal("cl"), Type.Literal("dl"), Type.Literal("L"), Type.Literal("tsp"), Type.Literal("tbsp"), Type.Literal("piece")]) })),
}));
const supplySchema = Type.Array(Type.Object({
  id: Type.Integer(), product_id: Type.Integer(), package_option_id: Type.Integer(), quantity: Type.Number(),
  state: Type.Union([Type.Literal("active"), Type.Literal("completed"), Type.Literal("cleared")]),
  size: Type.Number(), unit: Type.Union([Type.Literal("unit"), Type.Literal("piece"), Type.Literal("g"), Type.Literal("kg"), Type.Literal("ml"), Type.Literal("cl"), Type.Literal("dl"), Type.Literal("L"), Type.Literal("tsp"), Type.Literal("tbsp")]),
  generated: Type.Number(), baseline_quantity: Type.Number(),
}));
const factors: Record<PackageUnit, number> = { unit: 1, piece: 1, g: 1, kg: 1000, ml: 1, cl: 10, dl: 100, L: 1000, tsp: 5, tbsp: 15 };
function unitFor(unit: PackageUnit): RecipeDemand["unit"] {
  return unit === "unit" || unit === "piece" ? "piece" : unit === "g" || unit === "kg" ? "g" : "ml";
}
export class RecipePlanningError extends Error {}

export class RecipePlanningStore {
  constructor(private readonly database: DatabaseSync) {}

  selections(): SelectedRecipe[] {
    const row = this.database.prepare("SELECT selections FROM recipe_plan WHERE id = 1").get();
    return Value.Parse(selectionSchema, JSON.parse(String(row?.selections ?? "[]")));
  }

  private supply() {
    return Value.Parse(supplySchema, this.database.prepare(`
      SELECT i.id, i.product_id, i.package_option_id, i.quantity, i.state, p.size, p.unit,
        COALESCE(g.quantity, 0) AS generated, COALESCE(b.quantity, 0) AS baseline_quantity
      FROM shopping_items i JOIN package_options p ON p.id = i.package_option_id
      LEFT JOIN recipe_generated g ON g.item_id = i.id
      LEFT JOIN recipe_baseline b ON b.item_id = i.id
    `).all());
  }

  sources(itemId: number): ItemRecipeSources {
    const item = this.supply().find((row) => row.id === itemId);
    return item ? { baseline: Math.min(item.baseline_quantity, Math.max(0, item.quantity - item.generated)), generated: Math.min(item.generated, item.quantity) } : { baseline: 0, generated: 0 };
  }

  demands(): RecipeDemand[] {
    const demands = new Map<number, RecipeDemand>();
    for (const selection of this.selections()) {
      for (const line of calculateRecipePreview(selection.requirements, selection.count)) {
        const current = demands.get(line.productId) ?? { ...line, amount: 0, baseline: 0, supply: 0, clearedPurchased: 0, contributions: [] };
        if (current.unit !== line.unit) throw new RecipePlanningError("Selected Recipes use incompatible dimensions for a Product");
        current.amount += line.amount;
        if (!Number.isFinite(current.amount)) throw new RecipePlanningError("Recipe demand is too large");
        current.contributions.push({ recipeId: selection.recipeId, name: selection.name, count: selection.count, amount: line.amount });
        demands.set(line.productId, current);
      }
    }
    const baseline = Value.Parse(Type.Array(Type.Object({ product_id: Type.Integer(), amount: Type.Number(), unit: Type.String() })),
      this.database.prepare("SELECT product_id, amount, unit FROM recipe_baseline").all());
    for (const row of baseline) {
      const demand = demands.get(row.product_id);
      if (demand?.unit === row.unit) demand.baseline += row.amount;
    }
    for (const row of this.supply()) {
      const demand = demands.get(row.product_id);
      if (demand?.unit !== unitFor(row.unit)) continue;
      const capacity = row.quantity * row.size * factors[row.unit];
      demand.supply += capacity;
      if (row.state === "cleared") demand.clearedPurchased += capacity;
    }
    return [...demands.values()];
  }

  replace(inputs: readonly RecipeSelectionInput[], recipes: readonly Recipe[]): void {
    const previous = this.selections();
    const seen = new Set<number>();
    const next = inputs.map((input) => {
      if (!Number.isSafeInteger(input.count) || input.count < 1) throw new RecipePlanningError("Recipe count must be a positive whole number");
      if (seen.has(input.recipeId)) throw new RecipePlanningError("A Recipe may only be selected once");
      seen.add(input.recipeId);
      const existing = previous.find((selection) => selection.recipeId === input.recipeId);
      const recipe = recipes.find((candidate) => candidate.id === input.recipeId);
      if (!recipe || (recipe.archived && !existing)) throw new RecipePlanningError("Recipe is not available");
      return existing ? { ...existing, count: input.count } : { recipeId: recipe.id, name: recipe.name, requirements: recipe.requirements, count: input.count };
    });
    if (JSON.stringify(previous) === JSON.stringify(next)) return;
    const captured = this.database.prepare("SELECT 1 FROM recipe_plan WHERE id = 1").get();
    if (!captured && next.length > 0) {
      for (const item of this.supply()) {
        this.database.prepare(`INSERT INTO recipe_baseline (item_id, product_id, quantity, amount, unit) VALUES (?, ?, ?, ?, ?)`)
          .run(item.id, item.product_id, item.quantity, item.quantity * item.size * factors[item.unit], unitFor(item.unit));
      }
    }
    if (captured || next.length > 0) {
      this.database.prepare("INSERT INTO recipe_plan (id, selections) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET selections = excluded.selections").run(JSON.stringify(next));
    }
    const changedProducts = new Set<number>();
    for (const selection of [...previous, ...next]) {
      if (previous.find((item) => item.recipeId === selection.recipeId)?.count === next.find((item) => item.recipeId === selection.recipeId)?.count) continue;
      selection.requirements.forEach((requirement) => changedProducts.add(requirement.productId));
    }
    this.recalculate(changedProducts);
  }

  mergeItems(fromId: number, intoId: number): void {
    this.database.prepare(`INSERT INTO recipe_generated (item_id, quantity)
      SELECT ?, quantity FROM recipe_generated WHERE item_id = ?
      ON CONFLICT(item_id) DO UPDATE SET quantity = quantity + excluded.quantity`).run(intoId, fromId);
    const baseline = this.database.prepare("SELECT id FROM recipe_baseline WHERE item_id = ?").get(intoId);
    if (baseline) {
      this.database.prepare(`UPDATE recipe_baseline SET quantity = quantity + COALESCE((SELECT quantity FROM recipe_baseline WHERE item_id = ?), 0),
        amount = amount + COALESCE((SELECT amount FROM recipe_baseline WHERE item_id = ?), 0) WHERE item_id = ?`).run(fromId, fromId, intoId);
      this.database.prepare("DELETE FROM recipe_baseline WHERE item_id = ?").run(fromId);
    } else this.database.prepare("UPDATE recipe_baseline SET item_id = ? WHERE item_id = ?").run(intoId, fromId);
  }

  private recalculate(productIds: ReadonlySet<number>): void {
    const demands = this.demands();
    const supply = this.supply();
    for (const productId of productIds) {
      const demand = demands.find((candidate) => candidate.productId === productId);
      const generated = supply.filter((item) => item.product_id === productId && item.generated > 0);
      const purchased = generated.filter((item) => item.state !== "active" && unitFor(item.unit) === demand?.unit)
        .reduce((sum, item) => sum + Math.min(item.generated, item.quantity) * item.size * factors[item.unit], 0);
      const shortfall = Math.max(0, (demand?.amount ?? 0) - (demand?.baseline ?? 0) - purchased);
      for (const item of generated.filter((candidate) => candidate.state === "active")) {
        const remaining = item.quantity - Math.min(item.quantity, item.generated);
        this.database.prepare("DELETE FROM recipe_generated WHERE item_id = ?").run(item.id);
        if (remaining > 0) this.database.prepare("UPDATE shopping_items SET quantity = ? WHERE id = ?").run(remaining, item.id);
        else this.database.prepare("DELETE FROM shopping_items WHERE id = ?").run(item.id);
      }
      if (shortfall === 0) continue;
      const option = Value.Parse(Type.Object({ id: Type.Integer(), size: Type.Number(), unit: supplySchema.items.properties.unit }),
        this.database.prepare("SELECT id, size, unit FROM package_options WHERE product_id = ? AND is_default = 1 AND archived = 0").get(productId));
      if (unitFor(option.unit) !== demand?.unit) throw new RecipePlanningError("Default Package Option is incompatible with Recipe demand");
      const quantity = Math.ceil(shortfall / (option.size * factors[option.unit]));
      if (!Number.isSafeInteger(quantity) || quantity < 1) throw new RecipePlanningError("Recipe demand is too large");
      const row = this.database.prepare(`INSERT INTO shopping_items (product_id, package_option_id, quantity, state, active_position)
        VALUES (?, ?, ?, 'active', (SELECT COALESCE(MAX(active_position), 0) + 1 FROM shopping_items))
        ON CONFLICT (product_id, package_option_id) WHERE state = 'active' DO UPDATE SET quantity = quantity + excluded.quantity RETURNING id`)
        .get(productId, option.id, quantity);
      this.database.prepare("INSERT INTO recipe_generated (item_id, quantity) VALUES (?, ?)").run(Number(row?.id), quantity);
    }
  }
}
