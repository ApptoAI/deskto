import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { DatabaseSync } from "node:sqlite"

import { migrate } from "./migrations.js"

export function openDatabase(path: string): DatabaseSync {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true })

  const database = new DatabaseSync(path)
  database.exec("PRAGMA foreign_keys = ON")
  database.exec("PRAGMA journal_mode = WAL")
  database.exec("PRAGMA busy_timeout = 5000")
  migrate(database)
  return database
}

export function transaction<T>(database: DatabaseSync, operation: () => T): T {
  // Storage helpers compose into larger use-case transactions. When an outer
  // transaction already owns the connection, let it commit or roll back the
  // complete operation instead of trying to start a nested SQLite transaction.
  if (database.isTransaction) return operation()
  database.exec("BEGIN IMMEDIATE")
  try {
    const result = operation()
    database.exec("COMMIT")
    return result
  } catch (error) {
    database.exec("ROLLBACK")
    throw error
  }
}
