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
      UNIQUE (product_id, package_option_id)
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
