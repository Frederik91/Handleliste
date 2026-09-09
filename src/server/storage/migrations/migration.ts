import type { DatabaseSync } from "node:sqlite";

export interface SchemaMigration {
  readonly version: number;
  readonly migrate: (database: DatabaseSync) => void;
}

export function runSchemaMigrations(
  database: DatabaseSync,
  migrations: readonly SchemaMigration[],
): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    ) STRICT;
  `);

  const hasMigration = database.prepare(
    "SELECT 1 FROM schema_migrations WHERE version = ?",
  );
  const recordMigration = database.prepare(
    "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
  );

  for (const migration of [...migrations].sort((left, right) => left.version - right.version)) {
    if (hasMigration.get(migration.version)) continue;
    migration.migrate(database);
    recordMigration.run(migration.version, Date.now());
  }
}
