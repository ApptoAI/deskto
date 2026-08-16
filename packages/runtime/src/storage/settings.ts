import type { DatabaseSync } from "node:sqlite"

import { jsonValueSchema, type JsonValue } from "@openappto/protocol"

/** Key-value settings persisted as JSON. */
export class Settings {
  constructor(private readonly database: DatabaseSync) {}

  get(key: string): JsonValue | null {
    // SAFETY: settings.value is non-null text and key is the primary key, so
    // the query returns that field once or yields undefined.
    const row = this.database
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get(key) as { value: string } | undefined
    if (!row) return null
    try {
      const parsed = jsonValueSchema.safeParse(JSON.parse(row.value))
      return parsed.success ? parsed.data : null
    } catch {
      return null
    }
  }

  set(key: string, value: JsonValue): void {
    this.database
      .prepare(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
      )
      .run(key, JSON.stringify(value))
  }

  delete(key: string): void {
    this.database.prepare("DELETE FROM settings WHERE key = ?").run(key)
  }
}
