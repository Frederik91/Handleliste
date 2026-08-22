import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ParsedQuickEntry, QuickEntryRepository } from "../domain/quick-entry.js";
import { measurementDimensionFor } from "../shared/package-option.js";
import { normalizeProductName } from "../shared/product-name.js";
import { prepareShoppingListSchema } from "./shopping-list-schema.js";
import type { MeasurementDimension, PackageUnit, Product, ShoppingItemEdit, ShoppingListItem, ShoppingListMutation, ShoppingListSnapshot } from "../shared/shopping-list.js";

interface ProductRow { id: number; name: string }
interface PackageOptionRow {
  id: number;
  is_default: number;
  measurement_dimension: MeasurementDimension;
  product_id: number;
  size: number;
  unit: PackageUnit;
}

export class ShoppingListStore implements QuickEntryRepository {
  readonly #database: DatabaseSync;

  constructor(dataDirectory: string) {
    mkdirSync(dataDirectory, { recursive: true });
    this.#database = new DatabaseSync(join(dataDirectory, "handleliste.sqlite"));
    this.#database.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    prepareShoppingListSchema(this.#database);
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
        INSERT INTO shopping_items (product_id, package_option_id, quantity)
        VALUES (?, ?, ?)
        ON CONFLICT (product_id, package_option_id)
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
      SELECT id, product_id, package_option_id, quantity FROM shopping_items ORDER BY id
    `).all().map((row) => {
      const item = row as { id: number; package_option_id: number; product_id: number; quantity: number };
      const product = productById.get(item.product_id);
      const packageOption = product?.packageOptions.find((option) => option.id === item.package_option_id);
      if (!product || !packageOption) throw new Error("Shopping Item references missing catalog data");
      return {
        id: item.id,
        packageOption,
        product: { id: product.id, name: product.name },
        quantity: item.quantity,
      } satisfies ShoppingListItem;
    });
    const state = this.#database.prepare("SELECT revision FROM shopping_list_state WHERE id = 1").get() as { revision: number };
    return { items, products, revision: state.revision };
  }

  updateItem(edit: ShoppingItemEdit): ShoppingListSnapshot {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const current = this.#database.prepare(`
        SELECT id, product_id, package_option_id FROM shopping_items WHERE id = ?
      `).get(edit.itemId) as { id: number; package_option_id: number; product_id: number } | undefined;
      if (!current) throw new ShoppingListCommandError("Shopping Item does not exist");
      const resolvedProduct = this.#resolveEditedProduct(current.product_id, edit.productName, edit.productId);
      const desiredOption = {
        measurementDimension: measurementDimensionFor(edit.packageUnit),
        size: edit.packageSize,
        unit: edit.packageUnit,
      };
      const targetOption = current.product_id === resolvedProduct.product.id
        ? this.#editCurrentPackageOption(current.package_option_id, desiredOption)
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
        this.#database.prepare("DELETE FROM shopping_items WHERE id = ?").run(edit.itemId);
        this.#database.prepare(`
          INSERT INTO shopping_items (product_id, package_option_id, quantity)
          VALUES (?, ?, ?)
          ON CONFLICT (product_id, package_option_id)
          DO UPDATE SET quantity = quantity + excluded.quantity
        `).run(resolvedProduct.product.id, targetOption.id, edit.quantity);
        this.#database.prepare(`
          DELETE FROM package_options WHERE id = ? AND is_default = 0
          AND NOT EXISTS (SELECT 1 FROM shopping_items WHERE package_option_id = ?)
        `).run(current.package_option_id, current.package_option_id);
      }
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
        SELECT id, quantity FROM shopping_items WHERE product_id = ? AND package_option_id = ?
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
        `).run(undo.package_option_id, undo.package_option_id);
      }
      if (undo.created_product === 1) {
        const hasItems = this.#database.prepare("SELECT 1 FROM shopping_items WHERE product_id = ? LIMIT 1")
          .get(undo.product_id);
        if (!hasItems) {
          this.#database.prepare("DELETE FROM quick_entry_undo WHERE product_id = ?").run(undo.product_id);
          this.#database.prepare("DELETE FROM package_options WHERE product_id = ?").run(undo.product_id);
          this.#database.prepare("DELETE FROM products WHERE id = ?").run(undo.product_id);
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
