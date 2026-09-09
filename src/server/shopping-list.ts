import { Type } from "typebox";
import { Value } from "typebox/value";
import { measurementDimensionSchema } from "../domain/shopping-list.js";
import { recipeRowSchema, recipeRequirementRowSchema, type RecipeRow } from "./storage/shopping-list-rows.js";
import { RecipePlanningStore, RecipePlanningError } from "./recipe-planning.js";
import type { RecipeSelectionInput } from "../domain/recipe-planning.js";
import { calculateRecipePreview, RecipeMeasurementError } from "../domain/recipe-measurement.js";
import { recipeUnitDimension, type Recipe, type RecipeInput, type RecipePreview } from "../domain/recipe.js";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { ParsedQuickEntry, QuickEntryRepository } from "../domain/quick-entry.js";
import { measurementDimensionFor } from "../domain/package-option.js";
import { normalizeProductName } from "../domain/product-name.js";
import type {
  AlwaysInStockDefinition,
  AlwaysInStockDefinitionInput,
  AlwaysInStockSelection,
  AlwaysInStockSelectionInput,
  Product,
  ShoppingItemEdit,
  ShoppingListItem,
  ShoppingListMutation,
  ShoppingListSnapshot,
} from "../domain/shopping-list.js";
import type {
  AlwaysInStockDefinitionRow,
  PackageOptionRow,
  ProductRow,
} from "./storage/shopping-list-rows.js";
import { openShoppingListDatabase } from "./storage/open-shopping-list-database.js";

export class ShoppingListStore implements QuickEntryRepository {
  readonly #database: DatabaseSync;
  readonly #recipePlanning: RecipePlanningStore;

  constructor(dataDirectory: string) {
    this.#database = openShoppingListDatabase(dataDirectory);
    this.#recipePlanning = new RecipePlanningStore(this.#database);
  }

  addParsedQuickEntry(entry: ParsedQuickEntry, selectedProductId?: number): ShoppingListMutation {
    let undoToken: string;
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      this.#database.prepare("DELETE FROM quick_entry_undo WHERE created_at < ?").run(Date.now() - 60_000);
      const resolvedProduct = selectedProductId === undefined
        ? this.#findOrCreateProduct(entry.productName)
        : { created: false, product: this.#getProduct(selectedProductId) };
      const resolvedOption = entry.packageOption
        ? this.#findOrCreateExplicitPackageOption(
            resolvedProduct.product.id,
            entry.packageOption,
            resolvedProduct.created,
          )
        : { created: resolvedProduct.created, packageOption: this.#getDefaultPackageOption(resolvedProduct.product.id) };
      this.#database.prepare(`
        INSERT INTO shopping_items
          (product_id, package_option_id, quantity, state, active_position)
        VALUES (
          ?, ?, ?, 'active',
          (SELECT COALESCE(MAX(active_position), 0) + 1 FROM shopping_items)
        )
        ON CONFLICT (product_id, package_option_id) WHERE state = 'active'
        DO UPDATE SET quantity = quantity + excluded.quantity
      `).run(resolvedProduct.product.id, resolvedOption.packageOption.id, entry.quantity);
      undoToken = randomUUID();
      this.#database.prepare(`
        INSERT INTO quick_entry_undo
          (token, product_id, package_option_id, quantity_added, created_product, created_package_option, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        undoToken,
        resolvedProduct.product.id,
        resolvedOption.packageOption.id,
        entry.quantity,
        resolvedProduct.created ? 1 : 0,
        resolvedOption.created ? 1 : 0,
        Date.now(),
      );
      this.#incrementRevision();
      this.#database.exec("COMMIT");
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
    return { ...this.getSnapshot(), undoToken };
  }

  close(): void { this.#database.close(); }

  getSnapshot(): ShoppingListSnapshot {
    const products = this.#getProducts();
    const productById = new Map(products.map((product) => [product.id, product]));
    const items = this.#database.prepare(`
      SELECT id, product_id, package_option_id, quantity, state, active_position, completed_at
      FROM shopping_items
      WHERE state != 'cleared'
      ORDER BY
        CASE state WHEN 'active' THEN 0 ELSE 1 END,
        CASE state WHEN 'active' THEN active_position END,
        completed_at DESC,
        id DESC
    `).all().map((row) => {
      const item = row as {
        active_position: number;
        completed_at: number | null;
        id: number;
        package_option_id: number;
        product_id: number;
        quantity: number;
        state: "active" | "completed";
      };
      const product = productById.get(item.product_id);
      const packageOption = product?.packageOptions.find((option) => option.id === item.package_option_id);
      if (!product || !packageOption) throw new Error("Shopping Item references missing catalog data");
      const base = {
        recipeSources: this.#recipePlanning.sources(item.id),
        id: item.id,
        packageOption,
        product: { id: product.id, name: product.name },
        quantity: item.quantity,
      };
      if (item.state === "active") {
        return { ...base, state: { kind: "active", position: item.active_position } } satisfies ShoppingListItem;
      }
      if (item.completed_at === null) throw new Error("Completed Shopping Item has no completion time");
      return { ...base, state: { completedAt: item.completed_at, kind: "completed" } } satisfies ShoppingListItem;
    });
    const state = this.#database.prepare("SELECT revision FROM shopping_list_state WHERE id = 1").get() as { revision: number };
    return {
      alwaysInStockDefinitions: this.#getAlwaysInStockDefinitions(),
      alwaysInStockSelections: this.#getAlwaysInStockSelections(),
      items,
      products,
      recipes: this.#getRecipes(),
      selectedRecipes: this.#recipePlanning.selections(),
      recipeDemands: this.#recipePlanning.demands(),
      revision: state.revision,
    };
  }

  replaceRecipeSelections(selections: readonly RecipeSelectionInput[]): ShoppingListSnapshot {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      this.#recipePlanning.replace({ inputs: selections, recipes: this.#getRecipes() });
      this.#incrementRevision();
      this.#database.exec("COMMIT");
    } catch (error) {
      this.#database.exec("ROLLBACK");
      if (error instanceof RecipePlanningError || error instanceof RecipeMeasurementError) throw new ShoppingListCommandError(error.message);
      throw error;
    }
    return this.getSnapshot();
  }

  createRecipe(input: RecipeInput): ShoppingListSnapshot {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const normalized = this.#validateRecipeInput(input);
      const result = this.#database.prepare("INSERT INTO recipes (name, note) VALUES (?, ?)")
        .run(normalized.name, normalized.note ?? null);
      this.#replaceRecipeRequirements({ recipeId: Number(result.lastInsertRowid), requirements: normalized.requirements });
      this.#incrementRevision();
      this.#database.exec("COMMIT");
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
    return this.getSnapshot();
  }

  updateRecipe({ recipeId, input }: { recipeId: number; input: RecipeInput }): ShoppingListSnapshot {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      this.#getRecipe(recipeId);
      const normalized = this.#validateRecipeInput(input);
      this.#database.prepare("UPDATE recipes SET name = ?, note = ? WHERE id = ?")
        .run(normalized.name, normalized.note ?? null, recipeId);
      this.#replaceRecipeRequirements({ recipeId, requirements: normalized.requirements });
      this.#incrementRevision();
      this.#database.exec("COMMIT");
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
    return this.getSnapshot();
  }

  archiveRecipe({ recipeId, archived }: { recipeId: number; archived: boolean }): ShoppingListSnapshot {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const recipe = this.#getRecipe(recipeId);
      if (recipe.archived !== (archived ? 1 : 0)) {
        this.#database.prepare("UPDATE recipes SET archived = ? WHERE id = ?")
          .run(archived ? 1 : 0, recipeId);
        this.#incrementRevision();
      }
      this.#database.exec("COMMIT");
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
    return this.getSnapshot();
  }

  previewRecipe({ recipeId, count }: { recipeId: number; count: number }): RecipePreview {
    const recipe = this.#getRecipes().find((candidate) => candidate.id === recipeId);
    if (!recipe) throw new ShoppingListCommandError("Recipe does not exist");
    try {
      return { count, lines: calculateRecipePreview({ requirements: recipe.requirements, count }), recipeId };
    } catch (error) {
      if (error instanceof RecipeMeasurementError) throw new ShoppingListCommandError(error.message);
      throw error;
    }
  }

  createAlwaysInStockDefinition(input: AlwaysInStockDefinitionInput): ShoppingListSnapshot {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      this.#assertPositiveQuantity(input.defaultQuantity);
      const packageOption = this.#getActivePackageOptionForProduct(input.productId, input.packageOptionId);
      this.#assertNoActiveAlwaysInStockDefinition(input.productId, packageOption.id);
      const position = this.#database.prepare(
        "SELECT COALESCE(MAX(position), 0) + 1 AS position FROM always_in_stock_definitions",
      ).get() as { position: number };
      this.#database.prepare(`
        INSERT INTO always_in_stock_definitions
          (product_id, package_option_id, default_quantity, position)
        VALUES (?, ?, ?, ?)
      `).run(input.productId, input.packageOptionId, input.defaultQuantity, position.position);
      this.#incrementRevision();
      this.#database.exec("COMMIT");
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
    return this.getSnapshot();
  }

  updateAlwaysInStockDefinition(
    definitionId: number,
    input: AlwaysInStockDefinitionInput,
  ): ShoppingListSnapshot {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      this.#assertPositiveQuantity(input.defaultQuantity);
      const current = this.#getAlwaysInStockDefinition(definitionId);
      const packageOption = this.#getActivePackageOptionForProduct(input.productId, input.packageOptionId);
      this.#assertNoActiveAlwaysInStockDefinition(input.productId, packageOption.id, definitionId);
      const selection = this.#database.prepare(`
        SELECT quantity FROM always_in_stock_selections WHERE definition_id = ?
      `).get(definitionId) as { quantity: number } | undefined;
      const packageChanged = current.product_id !== input.productId || current.package_option_id !== input.packageOptionId;
      if (selection && packageChanged) this.#removeAlwaysInStockContribution(definitionId);
      this.#database.prepare(`
        UPDATE always_in_stock_definitions
        SET product_id = ?, package_option_id = ?, default_quantity = ?
        WHERE id = ?
      `).run(input.productId, input.packageOptionId, input.defaultQuantity, definitionId);
      if (selection && packageChanged) this.#addAlwaysInStockContribution(definitionId, selection.quantity);
      if (current.product_id !== input.productId || current.package_option_id !== input.packageOptionId || current.default_quantity !== input.defaultQuantity) {
        this.#incrementRevision();
      }
      this.#database.exec("COMMIT");
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
    return this.getSnapshot();
  }

  archiveAlwaysInStockDefinition(definitionId: number, archived: boolean): ShoppingListSnapshot {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const current = this.#getAlwaysInStockDefinition(definitionId);
      if (current.archived === (archived ? 1 : 0)) {
        this.#database.exec("COMMIT");
        return this.getSnapshot();
      }
      if (archived) {
        this.#removeAlwaysInStockContribution(definitionId);
        this.#database.prepare("DELETE FROM always_in_stock_selections WHERE definition_id = ?").run(definitionId);
      }
      this.#database.prepare("UPDATE always_in_stock_definitions SET archived = ? WHERE id = ?")
        .run(archived ? 1 : 0, definitionId);
      this.#incrementRevision();
      this.#database.exec("COMMIT");
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
    return this.getSnapshot();
  }

  reorderAlwaysInStockDefinitions(definitionIds: readonly number[]): ShoppingListSnapshot {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const definitions = this.#database.prepare(
        "SELECT id FROM always_in_stock_definitions ORDER BY position, id",
      ).all() as Array<{ id: number }>;
      if (
        definitionIds.length !== definitions.length
        || new Set(definitionIds).size !== definitionIds.length
        || definitions.some((definition) => !definitionIds.includes(definition.id))
      ) {
        throw new ShoppingListCommandError("Always in Stock definition order is invalid");
      }
      const update = this.#database.prepare("UPDATE always_in_stock_definitions SET position = ? WHERE id = ?");
      definitionIds.forEach((definitionId, index) => update.run(index + 1, definitionId));
      this.#incrementRevision();
      this.#database.exec("COMMIT");
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
    return this.getSnapshot();
  }

  replaceAlwaysInStockSelections(selections: readonly AlwaysInStockSelectionInput[]): ShoppingListSnapshot {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const definitionIds = new Set<number>();
      for (const selection of selections) {
        this.#assertPositiveQuantity(selection.quantity);
        if (definitionIds.has(selection.definitionId)) {
          throw new ShoppingListCommandError("An Always in Stock definition can only be selected once");
        }
        definitionIds.add(selection.definitionId);
        const definition = this.#getAlwaysInStockDefinition(selection.definitionId);
        if (definition.archived === 1) throw new ShoppingListCommandError("Archived Always in Stock definitions cannot be selected");
      }
      const current = this.#getAlwaysInStockSelections();
      const currentByDefinition = new Map(current.map((selection) => [selection.definitionId, selection.quantity]));
      const nextByDefinition = new Map(selections.map((selection) => [selection.definitionId, selection.quantity]));
      for (const selection of current) {
        const nextQuantity = nextByDefinition.get(selection.definitionId);
        if (nextQuantity === undefined) {
          this.#removeAlwaysInStockContribution(selection.definitionId);
          this.#database.prepare("DELETE FROM always_in_stock_selections WHERE definition_id = ?")
            .run(selection.definitionId);
        } else if (nextQuantity !== selection.quantity) {
          this.#updateAlwaysInStockContribution(selection.definitionId, nextQuantity);
          this.#database.prepare("UPDATE always_in_stock_selections SET quantity = ? WHERE definition_id = ?")
            .run(nextQuantity, selection.definitionId);
        }
      }
      for (const selection of selections) {
        if (currentByDefinition.has(selection.definitionId)) continue;
        this.#database.prepare(`
          INSERT INTO always_in_stock_selections (definition_id, quantity) VALUES (?, ?)
        `).run(selection.definitionId, selection.quantity);
        this.#addAlwaysInStockContribution(selection.definitionId, selection.quantity);
      }
      this.#incrementRevision();
      this.#database.exec("COMMIT");
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
    return this.getSnapshot();
  }

  updateItem(edit: ShoppingItemEdit): ShoppingListSnapshot {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const current = this.#database.prepare(`
        SELECT id, product_id, package_option_id, state FROM shopping_items WHERE id = ?
      `).get(edit.itemId) as { id: number; package_option_id: number; product_id: number; state: string } | undefined;
      if (!current) throw new ShoppingListCommandError("Shopping Item does not exist");
      if (current.state !== "active") throw new ShoppingListCommandError("Only active Shopping Items can be edited");
      const resolvedProduct = this.#resolveEditedProduct(current.product_id, edit.productName, edit.productId);
      const desiredOption = {
        measurementDimension: measurementDimensionFor(edit.packageUnit),
        size: edit.packageSize,
        unit: edit.packageUnit,
      };
      const targetOption = current.product_id === resolvedProduct.product.id
        ? this.#editCurrentPackageOption(edit.itemId, current.package_option_id, desiredOption)
        : this.#findOrCreateExplicitPackageOption(
            resolvedProduct.product.id,
            desiredOption,
            resolvedProduct.created,
          ).packageOption;
      this.#database.prepare("DELETE FROM quick_entry_undo WHERE product_id = ? OR product_id = ?")
        .run(current.product_id, resolvedProduct.product.id);

      if (current.product_id === resolvedProduct.product.id && current.package_option_id === targetOption.id) {
        this.#database.prepare("UPDATE shopping_items SET quantity = ? WHERE id = ?")
          .run(edit.quantity, edit.itemId);
      } else {
        const target = this.#database.prepare(`
          INSERT INTO shopping_items
            (product_id, package_option_id, quantity, state, active_position)
          VALUES (
            ?, ?, ?, 'active',
            (SELECT COALESCE(MAX(active_position), 0) + 1 FROM shopping_items)
          )
          ON CONFLICT (product_id, package_option_id) WHERE state = 'active'
          DO UPDATE SET quantity = quantity + excluded.quantity
          RETURNING id
        `).get(resolvedProduct.product.id, targetOption.id, edit.quantity);
        if (current.product_id === resolvedProduct.product.id) {
          this.#database.prepare("UPDATE recipe_generated SET quantity = MIN(quantity, ?) WHERE item_id = ?").run(edit.quantity, edit.itemId);
          this.#recipePlanning.mergeItems({ fromId: edit.itemId, intoId: Number(target?.id) });
          this.#database.prepare("UPDATE shopping_item_contributions SET shopping_item_id = ? WHERE shopping_item_id = ?").run(Number(target?.id), edit.itemId);
        }
        this.#database.prepare("DELETE FROM shopping_items WHERE id = ?").run(edit.itemId);
        this.#database.prepare(`
          DELETE FROM package_options WHERE id = ? AND is_default = 0
          AND NOT EXISTS (SELECT 1 FROM shopping_items WHERE package_option_id = ?)
          AND NOT EXISTS (SELECT 1 FROM always_in_stock_definitions WHERE package_option_id = ?)
        `).run(current.package_option_id, current.package_option_id, current.package_option_id);
      }
      this.#incrementRevision();
      this.#database.exec("COMMIT");
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
    return this.getSnapshot();
  }

  setItemCompletion(itemId: number, completed: boolean): ShoppingListSnapshot {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const item = this.#database.prepare(`
        SELECT product_id, package_option_id, state FROM shopping_items WHERE id = ?
      `).get(itemId) as
        | { package_option_id: number; product_id: number; state: "active" | "cleared" | "completed" }
        | undefined;
      if (!item) throw new ShoppingListCommandError("Shopping Item does not exist");
      if (item.state === "cleared") throw new ShoppingListCommandError("Cleared Shopping Item cannot be changed");
      const desiredState = completed ? "completed" : "active";
      if (item.state !== desiredState) {
        if (completed) {
          this.#database.prepare(`
            UPDATE shopping_items SET state = 'completed', completed_at = ? WHERE id = ?
          `).run(Date.now(), itemId);
        } else {
          const duplicate = this.#database.prepare(`
            SELECT id, quantity FROM shopping_items
            WHERE product_id = ? AND package_option_id = ? AND state = 'active'
          `).get(item.product_id, item.package_option_id) as { id: number; quantity: number } | undefined;
          if (duplicate) {
            this.#database.prepare(`
              UPDATE shopping_items
              SET quantity = quantity + (SELECT quantity FROM shopping_items WHERE id = ?)
              WHERE id = ?
            `).run(duplicate.id, itemId);
            this.#recipePlanning.mergeItems({ fromId: duplicate.id, intoId: itemId });
            this.#database.prepare("UPDATE shopping_item_contributions SET shopping_item_id = ? WHERE shopping_item_id = ?").run(itemId, duplicate.id);
            this.#database.prepare("DELETE FROM shopping_items WHERE id = ?").run(duplicate.id);
          }
          this.#database.prepare(`
            UPDATE shopping_items SET state = 'active', completed_at = NULL WHERE id = ?
          `).run(itemId);
        }
        this.#database.prepare("DELETE FROM quick_entry_undo WHERE product_id = (SELECT product_id FROM shopping_items WHERE id = ?)")
          .run(itemId);
        this.#incrementRevision();
      }
      this.#database.exec("COMMIT");
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
    return this.getSnapshot();
  }

  clearCompleted(): ShoppingListMutation {
    let undoToken: string;
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const completed = this.#database.prepare("SELECT 1 FROM shopping_items WHERE state = 'completed' LIMIT 1").get();
      if (!completed) throw new ShoppingListCommandError("There are no completed Shopping Items to clear");
      this.#database.prepare("DELETE FROM clear_completed_undo WHERE created_at < ?").run(Date.now() - 60_000);
      undoToken = randomUUID();
      this.#database.prepare("INSERT INTO clear_completed_undo (token, created_at) VALUES (?, ?)")
        .run(undoToken, Date.now());
      this.#database.prepare(`
        UPDATE shopping_items SET state = 'cleared', clear_undo_token = ? WHERE state = 'completed'
      `).run(undoToken);
      this.#incrementRevision();
      this.#database.exec("COMMIT");
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
    return { ...this.getSnapshot(), undoToken };
  }

  undoClearCompleted(token: string): ShoppingListSnapshot {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const undo = this.#database.prepare("SELECT created_at FROM clear_completed_undo WHERE token = ?").get(token) as
        | { created_at: number }
        | undefined;
      if (!undo || Date.now() - undo.created_at > 60_000) {
        throw new ShoppingListCommandError("Cleared Shopping Items can no longer be restored");
      }
      this.#database.prepare(`
        UPDATE shopping_items
        SET state = 'completed', clear_undo_token = NULL
        WHERE state = 'cleared' AND clear_undo_token = ?
      `).run(token);
      this.#database.prepare("DELETE FROM clear_completed_undo WHERE token = ?").run(token);
      this.#incrementRevision();
      this.#database.exec("COMMIT");
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
    return this.getSnapshot();
  }

  startNewTrip(): ShoppingListSnapshot {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      this.#database.exec(`
        DELETE FROM quick_entry_undo;
        DELETE FROM clear_completed_undo;
        DELETE FROM recipe_plan;
        DELETE FROM recipe_baseline;
        DELETE FROM recipe_generated;
        DELETE FROM always_in_stock_selections;
        DELETE FROM shopping_items;
      `);
      this.#incrementRevision();
      this.#database.exec("COMMIT");
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
    return this.getSnapshot();
  }

  undoQuickEntry(token: string): ShoppingListSnapshot {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const undo = this.#database.prepare(`
        SELECT product_id, package_option_id, quantity_added, created_product, created_package_option, created_at
        FROM quick_entry_undo WHERE token = ?
      `).get(token) as {
        created_at: number;
        created_package_option: number;
        created_product: number;
        package_option_id: number;
        product_id: number;
        quantity_added: number;
      } | undefined;
      if (!undo || Date.now() - undo.created_at > 60_000) {
        throw new ShoppingListCommandError("Quick Entry can no longer be undone");
      }
      this.#database.prepare("DELETE FROM quick_entry_undo WHERE token = ?").run(token);
      const item = this.#database.prepare(`
        SELECT id, quantity FROM shopping_items
        WHERE product_id = ? AND package_option_id = ? AND state = 'active'
      `).get(undo.product_id, undo.package_option_id) as { id: number; quantity: number } | undefined;
      if (item) {
        if (item.quantity <= undo.quantity_added) {
          this.#database.prepare("DELETE FROM shopping_items WHERE id = ?").run(item.id);
        } else {
          this.#database.prepare("UPDATE shopping_items SET quantity = quantity - ? WHERE id = ?")
            .run(undo.quantity_added, item.id);
        }
      }
      if (undo.created_package_option === 1) {
        this.#database.prepare(`
          DELETE FROM package_options WHERE id = ?
          AND NOT EXISTS (SELECT 1 FROM shopping_items WHERE package_option_id = ?)
          AND NOT EXISTS (SELECT 1 FROM always_in_stock_definitions WHERE package_option_id = ?)
          AND NOT EXISTS (
            SELECT 1 FROM recipe_requirements
            WHERE product_id = (SELECT product_id FROM package_options WHERE id = ?)
          )
        `).run(undo.package_option_id, undo.package_option_id, undo.package_option_id, undo.package_option_id);
      }
      if (undo.created_product === 1) {
        const hasItems = this.#database.prepare("SELECT 1 FROM shopping_items WHERE product_id = ? LIMIT 1")
          .get(undo.product_id);
        if (!hasItems) {
          this.#database.prepare("DELETE FROM quick_entry_undo WHERE product_id = ?").run(undo.product_id);
          this.#database.prepare(`
            DELETE FROM package_options WHERE product_id = ?
            AND NOT EXISTS (SELECT 1 FROM always_in_stock_definitions WHERE product_id = ?)
            AND NOT EXISTS (SELECT 1 FROM recipe_requirements WHERE product_id = ?)
          `).run(undo.product_id, undo.product_id, undo.product_id);
          this.#database.prepare(`
            DELETE FROM products WHERE id = ?
            AND NOT EXISTS (SELECT 1 FROM always_in_stock_definitions WHERE product_id = ?)
            AND NOT EXISTS (SELECT 1 FROM recipe_requirements WHERE product_id = ?)
          `).run(undo.product_id, undo.product_id, undo.product_id);
        }
      }
      this.#incrementRevision();
      this.#database.exec("COMMIT");
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
    return this.getSnapshot();
  }

  #getAlwaysInStockDefinitions(): AlwaysInStockDefinition[] {
    const definitions = this.#database.prepare(`
      SELECT id, product_id, package_option_id, default_quantity, position, archived
      FROM always_in_stock_definitions
      ORDER BY position, id
    `).all() as unknown as AlwaysInStockDefinitionRow[];
    return definitions.map((definition) => ({
      archived: definition.archived === 1,
      defaultQuantity: definition.default_quantity,
      id: definition.id,
      packageOptionId: definition.package_option_id,
      position: definition.position,
      productId: definition.product_id,
    }));
  }

  #getRecipes(): Recipe[] {
    const recipes = Value.Parse(Type.Array(recipeRowSchema), this.#database.prepare(`
      SELECT id, name, note, archived FROM recipes ORDER BY id
    `).all());
    const requirements = Value.Parse(Type.Array(recipeRequirementRowSchema), this.#database.prepare(`
      SELECT recipe_id, product_id, amount, unit
      FROM recipe_requirements ORDER BY recipe_id, position
    `).all());
    return recipes.map((recipe) => ({
      archived: recipe.archived === 1,
      id: recipe.id,
      name: recipe.name,
      ...(recipe.note === null ? {} : { note: recipe.note }),
      requirements: requirements
        .filter((requirement) => requirement.recipe_id === recipe.id)
        .map((requirement) => ({
          amount: requirement.amount,
          productId: requirement.product_id,
          unit: requirement.unit,
        })),
    }));
  }

  #getRecipe(recipeId: number): RecipeRow {
    const recipe = this.#database.prepare("SELECT id, name, note, archived FROM recipes WHERE id = ?")
      .get(recipeId);
    if (!recipe) throw new ShoppingListCommandError("Recipe does not exist");
    return Value.Parse(recipeRowSchema, recipe);
  }

  #validateRecipeInput(input: RecipeInput): RecipeInput {
    const name = input.name.trim();
    const note = input.note?.trim() || undefined;
    if (!name) throw new ShoppingListCommandError("Recipe name is required");
    if (input.requirements.length === 0) {
      throw new ShoppingListCommandError("A Recipe must have at least one Ingredient Requirement");
    }
    for (const requirement of input.requirements) {
      this.#getProduct(requirement.productId);
      const dimension = recipeUnitDimension(requirement.unit);
      const dimensions = Value.Parse(Type.Array(Type.Object({ measurement_dimension: measurementDimensionSchema })), this.#database.prepare(`
        SELECT DISTINCT measurement_dimension
        FROM package_options WHERE product_id = ? AND archived = 0
      `).all(requirement.productId));
      if (!dimensions.some((candidate) => candidate.measurement_dimension === dimension)) {
        throw new ShoppingListCommandError("Ingredient unit is incompatible with the Product's Package Options");
      }
    }
    try {
      calculateRecipePreview({ requirements: input.requirements, count: 1 });
    } catch (error) {
      if (error instanceof RecipeMeasurementError) throw new ShoppingListCommandError(error.message);
      throw error;
    }
    return { name, ...(note ? { note } : {}), requirements: input.requirements.map((requirement) => ({ ...requirement })) };
  }

  #replaceRecipeRequirements({ recipeId, requirements }: { recipeId: number; requirements: readonly RecipeInput["requirements"][number][] }): void {
    this.#database.prepare("DELETE FROM recipe_requirements WHERE recipe_id = ?").run(recipeId);
    const insert = this.#database.prepare(`
      INSERT INTO recipe_requirements (recipe_id, position, product_id, amount, unit)
      VALUES (?, ?, ?, ?, ?)
    `);
    requirements.forEach((requirement, index) => {
      insert.run(recipeId, index + 1, requirement.productId, requirement.amount, requirement.unit);
    });
  }

  #getAlwaysInStockSelections(): AlwaysInStockSelection[] {
    return this.#database.prepare(`
      SELECT definition_id, quantity
      FROM always_in_stock_selections
      ORDER BY definition_id
    `).all().map((row) => {
      const selection = row as { definition_id: number; quantity: number };
      return { definitionId: selection.definition_id, quantity: selection.quantity };
    });
  }

  #getAlwaysInStockDefinition(definitionId: number): AlwaysInStockDefinitionRow {
    const definition = this.#database.prepare(`
      SELECT id, product_id, package_option_id, default_quantity, position, archived
      FROM always_in_stock_definitions WHERE id = ?
    `).get(definitionId) as AlwaysInStockDefinitionRow | undefined;
    if (!definition) throw new ShoppingListCommandError("Always in Stock definition does not exist");
    return definition;
  }

  #getActivePackageOptionForProduct(productId: number, packageOptionId: number): PackageOptionRow {
    this.#getProduct(productId);
    const packageOption = this.#database.prepare(`
      SELECT id, product_id, size, unit, measurement_dimension, is_default
      FROM package_options
      WHERE id = ? AND product_id = ? AND archived = 0
    `).get(packageOptionId, productId) as PackageOptionRow | undefined;
    if (!packageOption) throw new ShoppingListCommandError("Package Option does not belong to the selected Product");
    return packageOption;
  }

  #assertNoActiveAlwaysInStockDefinition(
    productId: number,
    packageOptionId: number,
    exceptDefinitionId?: number,
  ): void {
    const duplicate = this.#database.prepare(`
      SELECT id FROM always_in_stock_definitions
      WHERE product_id = ? AND package_option_id = ? AND archived = 0
        AND (? IS NULL OR id != ?)
    `).get(productId, packageOptionId, exceptDefinitionId ?? null, exceptDefinitionId ?? null);
    if (duplicate) throw new ShoppingListCommandError("An active Always in Stock definition already uses this Package Option");
  }

  #assertPositiveQuantity(quantity: number): void {
    if (!Number.isSafeInteger(quantity) || quantity < 1) {
      throw new ShoppingListCommandError("Quantity must be a positive whole number");
    }
  }

  #addAlwaysInStockContribution(definitionId: number, quantity: number): void {
    const definition = this.#getAlwaysInStockDefinition(definitionId);
    const activeItem = this.#database.prepare(`
      SELECT id FROM shopping_items
      WHERE product_id = ? AND package_option_id = ? AND state = 'active'
    `).get(definition.product_id, definition.package_option_id) as { id: number } | undefined;
    let shoppingItemId: number;
    if (activeItem) {
      shoppingItemId = activeItem.id;
      this.#database.prepare("UPDATE shopping_items SET quantity = quantity + ? WHERE id = ?")
        .run(quantity, shoppingItemId);
    } else {
      const result = this.#database.prepare(`
        INSERT INTO shopping_items
          (product_id, package_option_id, quantity, state, active_position)
        VALUES (?, ?, ?, 'active', (SELECT COALESCE(MAX(active_position), 0) + 1 FROM shopping_items))
      `).run(definition.product_id, definition.package_option_id, quantity);
      shoppingItemId = Number(result.lastInsertRowid);
    }
    this.#database.prepare(`
      INSERT INTO shopping_item_contributions
        (shopping_item_id, source_kind, definition_id, quantity)
      VALUES (?, 'always-in-stock', ?, ?)
    `).run(shoppingItemId, definitionId, quantity);
  }

  #updateAlwaysInStockContribution(definitionId: number, quantity: number): void {
    const contribution = this.#database.prepare(`
      SELECT shopping_item_id, quantity
      FROM shopping_item_contributions WHERE definition_id = ?
    `).get(definitionId) as { quantity: number; shopping_item_id: number } | undefined;
    if (!contribution) {
      this.#addAlwaysInStockContribution(definitionId, quantity);
      return;
    }
    const item = this.#database.prepare("SELECT quantity FROM shopping_items WHERE id = ?")
      .get(contribution.shopping_item_id) as { quantity: number } | undefined;
    if (!item) {
      this.#database.prepare("DELETE FROM shopping_item_contributions WHERE definition_id = ?").run(definitionId);
      this.#addAlwaysInStockContribution(definitionId, quantity);
      return;
    }
    const nextItemQuantity = item.quantity - contribution.quantity + quantity;
    this.#database.prepare("UPDATE shopping_items SET quantity = ? WHERE id = ?")
      .run(nextItemQuantity, contribution.shopping_item_id);
    this.#database.prepare("UPDATE shopping_item_contributions SET quantity = ? WHERE definition_id = ?")
      .run(quantity, definitionId);
  }

  #removeAlwaysInStockContribution(definitionId: number): void {
    const contribution = this.#database.prepare(`
      SELECT shopping_item_id, quantity
      FROM shopping_item_contributions WHERE definition_id = ?
    `).get(definitionId) as { quantity: number; shopping_item_id: number } | undefined;
    if (!contribution) return;
    this.#database.prepare("DELETE FROM shopping_item_contributions WHERE definition_id = ?").run(definitionId);
    const item = this.#database.prepare("SELECT quantity FROM shopping_items WHERE id = ?")
      .get(contribution.shopping_item_id) as { quantity: number } | undefined;
    if (!item) return;
    const remaining = item.quantity - contribution.quantity;
    if (remaining > 0) {
      this.#database.prepare("UPDATE shopping_items SET quantity = ? WHERE id = ?")
        .run(remaining, contribution.shopping_item_id);
    } else {
      this.#database.prepare("DELETE FROM shopping_items WHERE id = ?").run(contribution.shopping_item_id);
    }
  }

  #findOrCreateProduct(name: string): { created: boolean; product: ProductRow } {
    const normalizedName = normalizeProductName(name);
    const existing = this.#database.prepare("SELECT id, name FROM products WHERE normalized_name = ?")
      .get(normalizedName) as ProductRow | undefined;
    if (existing) return { created: false, product: existing };
    const result = this.#database.prepare("INSERT INTO products (name, normalized_name) VALUES (?, ?)")
      .run(name, normalizedName);
    const product = { id: Number(result.lastInsertRowid), name };
    this.#createImplicitPackageOption(product.id);
    return { created: true, product };
  }

  #getProduct(productId: number): ProductRow {
    const product = this.#database.prepare("SELECT id, name FROM products WHERE id = ?")
      .get(productId) as ProductRow | undefined;
    if (!product) throw new ShoppingListCommandError("Selected Product does not exist");
    return product;
  }

  #resolveEditedProduct(
    currentProductId: number,
    productName: string,
    selectedProductId?: number,
  ): { created: boolean; product: ProductRow } {
    if (selectedProductId !== undefined) {
      return { created: false, product: this.#getProduct(selectedProductId) };
    }
    const normalizedName = normalizeProductName(productName);
    const existing = this.#database.prepare("SELECT id, name FROM products WHERE normalized_name = ?")
      .get(normalizedName) as ProductRow | undefined;
    if (existing) return { created: false, product: existing };

    const isCorrectableQuickEntryProduct = this.#database.prepare(`
      SELECT 1 FROM quick_entry_undo
      WHERE product_id = ? AND created_product = 1
      AND (SELECT COUNT(*) FROM shopping_items WHERE product_id = ?) = 1
      LIMIT 1
    `).get(currentProductId, currentProductId) !== undefined;
    if (isCorrectableQuickEntryProduct) {
      this.#database.prepare("UPDATE products SET name = ?, normalized_name = ? WHERE id = ?")
        .run(productName, normalizedName, currentProductId);
      return { created: false, product: { id: currentProductId, name: productName } };
    }
    return this.#findOrCreateProduct(productName);
  }

  #createImplicitPackageOption(productId: number): PackageOptionRow {
    const result = this.#database.prepare(`
      INSERT INTO package_options (product_id, size, unit, measurement_dimension, is_default, archived)
      VALUES (?, 1, 'unit', 'count', 1, 0)
    `).run(productId);
    return this.#getPackageOption(Number(result.lastInsertRowid));
  }

  #findOrCreateExplicitPackageOption(
    productId: number,
    parsed: NonNullable<ParsedQuickEntry["packageOption"]>,
    replaceImplicitDefault: boolean,
  ): { created: boolean; packageOption: PackageOptionRow } {
    const existing = this.#database.prepare(`
      SELECT id, product_id, size, unit, measurement_dimension, is_default FROM package_options
      WHERE product_id = ? AND size = ? AND unit = ? AND archived = 0
    `).get(productId, parsed.size, parsed.unit) as PackageOptionRow | undefined;
    if (existing) return { created: false, packageOption: existing };

    const onlyImplicitOption = replaceImplicitDefault ? this.#database.prepare(`
      SELECT id FROM package_options
      WHERE product_id = ? AND size = 1 AND unit = 'unit' AND is_default = 1
      AND NOT EXISTS (SELECT 1 FROM shopping_items WHERE package_option_id = package_options.id)
      AND NOT EXISTS (SELECT 1 FROM always_in_stock_definitions WHERE package_option_id = package_options.id)
      AND (SELECT COUNT(*) FROM package_options AS all_options WHERE all_options.product_id = ?) = 1
    `).get(productId, productId) as { id: number } | undefined : undefined;
    if (onlyImplicitOption) this.#database.prepare("DELETE FROM package_options WHERE id = ?").run(onlyImplicitOption.id);

    const result = this.#database.prepare(`
      INSERT INTO package_options (product_id, size, unit, measurement_dimension, is_default, archived)
      VALUES (?, ?, ?, ?, ?, 0)
    `).run(productId, parsed.size, parsed.unit, parsed.measurementDimension, onlyImplicitOption ? 1 : 0);
    return { created: true, packageOption: this.#getPackageOption(Number(result.lastInsertRowid)) };
  }

  #editCurrentPackageOption(
    shoppingItemId: number,
    packageOptionId: number,
    desired: NonNullable<ParsedQuickEntry["packageOption"]>,
  ): PackageOptionRow {
    const current = this.#getPackageOption(packageOptionId);
    if (current.size === desired.size && current.unit === desired.unit) return current;
    const existing = this.#database.prepare(`
      SELECT id, product_id, size, unit, measurement_dimension, is_default FROM package_options
      WHERE product_id = ? AND size = ? AND unit = ? AND archived = 0
    `).get(current.product_id, desired.size, desired.unit) as PackageOptionRow | undefined;
    if (existing) {
      if (current.is_default === 1 && existing.is_default === 0) {
        this.#database.prepare("UPDATE package_options SET is_default = 0 WHERE id = ?").run(current.id);
        this.#database.prepare("UPDATE package_options SET is_default = 1 WHERE id = ?").run(existing.id);
      }
      return existing;
    }
    const usedByAnotherItem = this.#database.prepare(`
      SELECT 1 FROM shopping_items WHERE package_option_id = ? AND id != ? LIMIT 1
    `).get(packageOptionId, shoppingItemId) !== undefined;
    if (usedByAnotherItem) {
      if (current.is_default === 1) {
        this.#database.prepare("UPDATE package_options SET is_default = 0 WHERE id = ?").run(current.id);
      }
      const result = this.#database.prepare(`
        INSERT INTO package_options
          (product_id, size, unit, measurement_dimension, is_default, archived)
        VALUES (?, ?, ?, ?, ?, 0)
      `).run(
        current.product_id,
        desired.size,
        desired.unit,
        desired.measurementDimension,
        current.is_default,
      );
      return this.#getPackageOption(Number(result.lastInsertRowid));
    }
    this.#database.prepare(`
      UPDATE package_options SET size = ?, unit = ?, measurement_dimension = ? WHERE id = ?
    `).run(desired.size, desired.unit, desired.measurementDimension, current.id);
    return this.#getPackageOption(current.id);
  }

  #getDefaultPackageOption(productId: number): PackageOptionRow {
    const option = this.#database.prepare(`
      SELECT id, product_id, size, unit, measurement_dimension, is_default FROM package_options
      WHERE product_id = ? AND is_default = 1 AND archived = 0
    `).get(productId) as PackageOptionRow | undefined;
    if (!option) throw new Error("Product has no Default Package Option");
    return option;
  }

  #getPackageOption(packageOptionId: number): PackageOptionRow {
    return this.#database.prepare(`
      SELECT id, product_id, size, unit, measurement_dimension, is_default FROM package_options WHERE id = ?
    `).get(packageOptionId) as unknown as PackageOptionRow;
  }

  #getProducts(): Product[] {
    const products = this.#database.prepare("SELECT id, name FROM products ORDER BY id").all() as unknown as ProductRow[];
    const options = this.#database.prepare(`
      SELECT id, product_id, size, unit, measurement_dimension, is_default
      FROM package_options WHERE archived = 0 ORDER BY id
    `).all() as unknown as PackageOptionRow[];
    return products.map((product) => ({
      ...product,
      packageOptions: options.filter((option) => option.product_id === product.id).map((option) => ({
        id: option.id,
        isDefault: option.is_default === 1,
        measurementDimension: option.measurement_dimension,
        size: option.size,
        unit: option.unit,
      })),
    }));
  }

  #incrementRevision(): void {
    this.#database.exec("UPDATE shopping_list_state SET revision = revision + 1 WHERE id = 1");
  }
}

export class ShoppingListCommandError extends Error {}
