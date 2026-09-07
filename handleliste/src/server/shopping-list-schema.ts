import type { DatabaseSync } from "node:sqlite";
import { migrateShoppingListSchema } from "./storage/migrations/index.js";

export function prepareShoppingListSchema(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, normalized_name TEXT NOT NULL UNIQUE
    ) STRICT;
    CREATE TABLE IF NOT EXISTS package_options (
      id INTEGER PRIMARY KEY,
      product_id INTEGER NOT NULL REFERENCES products(id),
      size REAL NOT NULL CHECK (size > 0),
      unit TEXT NOT NULL,
      measurement_dimension TEXT NOT NULL DEFAULT 'count'
        CHECK (measurement_dimension IN ('count', 'mass', 'volume')),
      is_default INTEGER NOT NULL CHECK (is_default IN (0, 1)),
      archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
      UNIQUE (product_id, size, unit)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS shopping_items (
      id INTEGER PRIMARY KEY,
      product_id INTEGER NOT NULL REFERENCES products(id),
      package_option_id INTEGER NOT NULL REFERENCES package_options(id),
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'completed', 'cleared')),
      active_position INTEGER NOT NULL CHECK (active_position > 0),
      completed_at INTEGER,
      clear_undo_token TEXT,
      CHECK (
        (state = 'active' AND completed_at IS NULL AND clear_undo_token IS NULL)
        OR (state = 'completed' AND completed_at IS NOT NULL AND clear_undo_token IS NULL)
        OR (state = 'cleared' AND completed_at IS NOT NULL AND clear_undo_token IS NOT NULL)
      )
    ) STRICT;
    CREATE UNIQUE INDEX IF NOT EXISTS one_default_package_option_per_product
    ON package_options (product_id) WHERE is_default = 1;
    CREATE TABLE IF NOT EXISTS always_in_stock_definitions (
      id INTEGER PRIMARY KEY,
      product_id INTEGER NOT NULL REFERENCES products(id),
      package_option_id INTEGER NOT NULL REFERENCES package_options(id),
      default_quantity INTEGER NOT NULL CHECK (default_quantity > 0),
      position INTEGER NOT NULL CHECK (position > 0),
      archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1))
    ) STRICT;
    CREATE UNIQUE INDEX IF NOT EXISTS one_active_always_in_stock_definition
    ON always_in_stock_definitions (product_id, package_option_id) WHERE archived = 0;
    CREATE TABLE IF NOT EXISTS always_in_stock_selections (
      definition_id INTEGER PRIMARY KEY REFERENCES always_in_stock_definitions(id) ON DELETE CASCADE,
      quantity INTEGER NOT NULL CHECK (quantity > 0)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS recipes (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL CHECK (length(trim(name)) > 0),
      note TEXT,
      archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1))
    ) STRICT;
    CREATE TABLE IF NOT EXISTS recipe_requirements (
      recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
      position INTEGER NOT NULL CHECK (position > 0),
      product_id INTEGER NOT NULL REFERENCES products(id),
      amount REAL NOT NULL CHECK (amount > 0),
      unit TEXT NOT NULL CHECK (unit IN ('g', 'kg', 'ml', 'cl', 'dl', 'L', 'tsp', 'tbsp', 'piece')),
      PRIMARY KEY (recipe_id, position)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS shopping_list_state (
      id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL CHECK (revision >= 0)
    ) STRICT;
    INSERT INTO shopping_list_state (id, revision) VALUES (1, 0) ON CONFLICT DO NOTHING;
    CREATE TABLE IF NOT EXISTS quick_entry_undo (
      token TEXT PRIMARY KEY,
      product_id INTEGER NOT NULL REFERENCES products(id),
      package_option_id INTEGER NOT NULL REFERENCES package_options(id),
      quantity_added INTEGER NOT NULL CHECK (quantity_added > 0),
      created_product INTEGER NOT NULL CHECK (created_product IN (0, 1)),
      created_package_option INTEGER NOT NULL CHECK (created_package_option IN (0, 1)),
      created_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS clear_completed_undo (
      token TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL
    ) STRICT;
  `);

  migrateShoppingListSchema(database);
  database.exec(`
    CREATE TABLE IF NOT EXISTS recipe_plan (
      id INTEGER PRIMARY KEY CHECK (id = 1), selections TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS recipe_baseline (
      id INTEGER PRIMARY KEY, item_id INTEGER UNIQUE REFERENCES shopping_items(id) ON DELETE SET NULL,
      product_id INTEGER NOT NULL REFERENCES products(id), quantity REAL NOT NULL,
      amount REAL NOT NULL, unit TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS recipe_generated (
      item_id INTEGER PRIMARY KEY REFERENCES shopping_items(id) ON DELETE CASCADE,
      quantity INTEGER NOT NULL CHECK (quantity > 0)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS shopping_item_contributions (
      shopping_item_id INTEGER NOT NULL REFERENCES shopping_items(id) ON DELETE CASCADE,
      source_kind TEXT NOT NULL CHECK (source_kind = 'always-in-stock'),
      definition_id INTEGER NOT NULL UNIQUE REFERENCES always_in_stock_definitions(id) ON DELETE CASCADE,
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      PRIMARY KEY (shopping_item_id, source_kind, definition_id)
    ) STRICT;


    CREATE UNIQUE INDEX IF NOT EXISTS one_active_shopping_item_per_package
    ON shopping_items (product_id, package_option_id) WHERE state = 'active';
  `);

}
