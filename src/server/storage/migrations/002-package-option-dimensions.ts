import type { SchemaMigration } from "./migration.js";

export const packageOptionDimensionsMigration: SchemaMigration = {
  version: 2,
  migrate(database) {
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
  },
};
