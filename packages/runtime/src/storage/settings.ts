import type { DatabaseSync } from "node:sqlite"

/** Key-value settings persisted as JSON. */
export class Settings {
  constructor(private readonly database: DatabaseSync) {}

  get<T>(key: string): T | null {
    const row = this.database
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get(key) as { value: string } | undefined
    if (!row) return null
    try {
      return JSON.parse(row.value) as T
    } catch {
      return null
    }
  }

  set(key: string, value: unknown): void {
    this.database
      .prepare(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
      )
      .run(key, JSON.stringify(value))
  }
}
