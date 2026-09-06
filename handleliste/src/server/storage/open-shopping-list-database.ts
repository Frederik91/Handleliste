import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { prepareShoppingListSchema } from "../shopping-list-schema.js";

export function openShoppingListDatabase(dataDirectory: string): DatabaseSync {
  mkdirSync(dataDirectory, { recursive: true });
  const database = new DatabaseSync(join(dataDirectory, "handleliste.sqlite"));
  database.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  prepareShoppingListSchema(database);
  return database;
}
