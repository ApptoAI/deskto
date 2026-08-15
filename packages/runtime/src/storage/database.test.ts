import { DatabaseSync } from "node:sqlite"

import { describe, expect, it } from "vitest"

import { transaction } from "./database.js"

describe("transaction", () => {
  it("lets an outer transaction roll back nested storage operations", () => {
    const database = new DatabaseSync(":memory:")
    database.exec("CREATE TABLE values_table (value TEXT NOT NULL)")

    expect(() =>
      transaction(database, () => {
        database.exec("INSERT INTO values_table VALUES ('outer')")
        transaction(database, () => {
          database.exec("INSERT INTO values_table VALUES ('nested')")
        })
        throw new Error("stop")
      })
    ).toThrow("stop")

    const row = database
      .prepare("SELECT COUNT(*) AS count FROM values_table")
      .get() as { count: number }
    expect(row.count).toBe(0)
    database.close()
  })
})
