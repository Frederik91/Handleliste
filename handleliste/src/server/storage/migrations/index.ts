import { shoppingItemStateMigration } from "./001-shopping-item-state.js";
import { packageOptionDimensionsMigration } from "./002-package-option-dimensions.js";
import { runSchemaMigrations } from "./migration.js";
import type { DatabaseSync } from "node:sqlite";

const migrations = [shoppingItemStateMigration, packageOptionDimensionsMigration] as const;

export function migrateShoppingListSchema(database: DatabaseSync): void {
  runSchemaMigrations(database, migrations);
}
