import type { DatabaseSync } from "node:sqlite";

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

  migrateShoppingItemState(database);
  database.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS one_active_shopping_item_per_package
    ON shopping_items (product_id, package_option_id) WHERE state = 'active';
  `);

  const columns = database.prepare("PRAGMA table_info(package_options)").all() as Array<{ name: string }>;
  if (columns.some((column) => column.name === "measurement_dimension")) return;

  database.exec(`
    PRAGMA foreign_keys = OFF;
    BEGIN IMMEDIATE;
    DROP INDEX IF EXISTS one_default_package_option_per_product;
    CREATE TABLE package_options_new (
      id INTEGER PRIMARY KEY,
      product_id INTEGER NOT NULL REFERENCES products(id),
      size REAL NOT NULL CHECK (size > 0),
      unit TEXT NOT NULL,
      measurement_dimension TEXT NOT NULL CHECK (measurement_dimension IN ('count', 'mass', 'volume')),
      is_default INTEGER NOT NULL CHECK (is_default IN (0, 1)),
      archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
      UNIQUE (product_id, size, unit)
    ) STRICT;
    INSERT INTO package_options_new (id, product_id, size, unit, measurement_dimension, is_default, archived)
    SELECT id, product_id, size, unit, 'count', is_default, 0 FROM package_options;
    DROP TABLE package_options;
    ALTER TABLE package_options_new RENAME TO package_options;
    CREATE UNIQUE INDEX one_default_package_option_per_product
    ON package_options (product_id) WHERE is_default = 1;
    COMMIT;
    PRAGMA foreign_keys = ON;
  `);
}

function migrateShoppingItemState(database: DatabaseSync): void {
  const columns = database.prepare("PRAGMA table_info(shopping_items)").all() as Array<{ name: string }>;
  if (columns.some((column) => column.name === "state")) return;

  database.exec(`
    PRAGMA foreign_keys = OFF;
    BEGIN IMMEDIATE;
    ALTER TABLE shopping_items RENAME TO shopping_items_before_trip_state;
    CREATE TABLE shopping_items (
      id INTEGER PRIMARY KEY,
      product_id INTEGER NOT NULL REFERENCES products(id),
      package_option_id INTEGER NOT NULL REFERENCES package_options(id),
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      state TEXT NOT NULL CHECK (state IN ('active', 'completed', 'cleared')),
      active_position INTEGER NOT NULL CHECK (active_position > 0),
      completed_at INTEGER,
      clear_undo_token TEXT,
      CHECK (
        (state = 'active' AND completed_at IS NULL AND clear_undo_token IS NULL)
        OR (state = 'completed' AND completed_at IS NOT NULL AND clear_undo_token IS NULL)
        OR (state = 'cleared' AND completed_at IS NOT NULL AND clear_undo_token IS NOT NULL)
      )
    ) STRICT;
    INSERT INTO shopping_items
      (id, product_id, package_option_id, quantity, state, active_position, completed_at, clear_undo_token)
    SELECT id, product_id, package_option_id, quantity, 'active', id, NULL, NULL
    FROM shopping_items_before_trip_state;
    DROP TABLE shopping_items_before_trip_state;
    CREATE UNIQUE INDEX one_active_shopping_item_per_package
    ON shopping_items (product_id, package_option_id) WHERE state = 'active';
    COMMIT;
    PRAGMA foreign_keys = ON;
  `);
}
