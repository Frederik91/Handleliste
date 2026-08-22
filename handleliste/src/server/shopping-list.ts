import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ShoppingListItem, ShoppingListSnapshot } from "../shared/shopping-list.js";

export class ShoppingListStore {
  readonly #database: DatabaseSync;

  constructor(dataDirectory: string) {
    mkdirSync(dataDirectory, { recursive: true });
    this.#database = new DatabaseSync(join(dataDirectory, "handleliste.sqlite"));
    this.#database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        normalized_name TEXT NOT NULL UNIQUE
      ) STRICT;

      CREATE TABLE IF NOT EXISTS package_options (
        id INTEGER PRIMARY KEY,
        product_id INTEGER NOT NULL REFERENCES products(id),
        size REAL NOT NULL CHECK (size > 0),
        unit TEXT NOT NULL CHECK (unit = 'unit'),
        is_default INTEGER NOT NULL CHECK (is_default IN (0, 1)),
        UNIQUE (product_id, size, unit)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS shopping_items (
        id INTEGER PRIMARY KEY,
        product_id INTEGER NOT NULL REFERENCES products(id),
        package_option_id INTEGER NOT NULL REFERENCES package_options(id),
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        UNIQUE (product_id, package_option_id)
      ) STRICT;

      CREATE UNIQUE INDEX IF NOT EXISTS one_default_package_option_per_product
      ON package_options (product_id)
      WHERE is_default = 1;

      CREATE TABLE IF NOT EXISTS shopping_list_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        revision INTEGER NOT NULL CHECK (revision >= 0)
      ) STRICT;

      INSERT INTO shopping_list_state (id, revision)
      VALUES (1, 0)
      ON CONFLICT DO NOTHING;
    `);
  }

  addQuickEntry(entry: string): ShoppingListSnapshot {
    const name = normalizeWhitespace(entry);
    const normalizedName = name.toLocaleLowerCase("en");

    this.#database.exec("BEGIN IMMEDIATE");
    try {
      this.#database
        .prepare("INSERT INTO products (name, normalized_name) VALUES (?, ?) ON CONFLICT DO NOTHING")
        .run(name, normalizedName);
      const product = this.#database
        .prepare("SELECT id FROM products WHERE normalized_name = ?")
        .get(normalizedName) as { id: number };
      this.#database
        .prepare(`
          INSERT INTO package_options (product_id, size, unit, is_default)
          VALUES (?, 1, 'unit', 1)
          ON CONFLICT DO NOTHING
        `)
        .run(product.id);
      const packageOption = this.#database
        .prepare("SELECT id FROM package_options WHERE product_id = ? AND size = 1 AND unit = 'unit'")
        .get(product.id) as { id: number };
      this.#database
        .prepare(`
          INSERT INTO shopping_items (product_id, package_option_id, quantity)
          VALUES (?, ?, 1)
          ON CONFLICT (product_id, package_option_id)
          DO UPDATE SET quantity = quantity + 1
        `)
        .run(product.id, packageOption.id);
      this.#database.exec("UPDATE shopping_list_state SET revision = revision + 1 WHERE id = 1");
      this.#database.exec("COMMIT");
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }

    return this.getSnapshot();
  }

  close(): void {
    this.#database.close();
  }

  getSnapshot(): ShoppingListSnapshot {
    const items = this.#database
      .prepare(`
        SELECT
          shopping_items.id,
          shopping_items.quantity,
          products.id AS product_id,
          products.name AS product_name,
          package_options.id AS package_option_id,
          package_options.size
        FROM shopping_items
        JOIN products ON products.id = shopping_items.product_id
        JOIN package_options ON package_options.id = shopping_items.package_option_id
        ORDER BY shopping_items.id
      `)
      .all()
      .map((row) => {
        const item = row as {
          id: number;
          package_option_id: number;
          product_id: number;
          product_name: string;
          quantity: number;
          size: number;
        };
        return {
          id: item.id,
          packageOption: {
            id: item.package_option_id,
            size: item.size,
            unit: "unit" as const,
          },
          product: {
            id: item.product_id,
            name: item.product_name,
          },
          quantity: item.quantity,
        };
      });
    const state = this.#database
      .prepare("SELECT revision FROM shopping_list_state WHERE id = 1")
      .get() as { revision: number };
    return { items, revision: state.revision };
  }
}

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}
