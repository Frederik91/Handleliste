import type { SchemaMigration } from "./migration.js";

export const shoppingItemStateMigration: SchemaMigration = {
  version: 1,
  migrate(database) {
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
  },
};
