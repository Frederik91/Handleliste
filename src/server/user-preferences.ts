import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type Locale = "en" | "nb";

export class UserPreferences {
  readonly #database: DatabaseSync;

  constructor(dataDirectory: string) {
    mkdirSync(dataDirectory, { recursive: true });
    this.#database = new DatabaseSync(join(dataDirectory, "handleliste.sqlite"));
    this.#database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS user_preferences (
        user_id TEXT PRIMARY KEY,
        locale TEXT NOT NULL CHECK (locale IN ('en', 'nb'))
      ) STRICT;
    `);
  }

  close(): void {
    this.#database.close();
  }

  getLocale(userId: string): Locale {
    const row = this.#database
      .prepare("SELECT locale FROM user_preferences WHERE user_id = ?")
      .get(userId) as { locale: Locale } | undefined;
    return row?.locale ?? "en";
  }

  setLocale(userId: string, locale: Locale): void {
    this.#database
      .prepare(`
        INSERT INTO user_preferences (user_id, locale)
        VALUES (?, ?)
        ON CONFLICT (user_id) DO UPDATE SET locale = excluded.locale
      `)
      .run(userId, locale);
  }
}
