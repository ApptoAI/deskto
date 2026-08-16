import type { DatabaseSync } from "node:sqlite"

import type { SkillProvisioningResult } from "@deskto/harness-sdk"
import type { SkillProvisioningReport } from "@deskto/protocol"

import { transaction } from "./database.js"

type SkillProvisioningRow = {
  turn_id: string
  root_id: string
  harness_id: string
  root_path: string
  content_digest: string | null
  status: SkillProvisioningReport["status"]
  method: SkillProvisioningReport["method"]
  message: string | null
  attempted_at: string
}

export class SkillProvisioningReports {
  constructor(private readonly database: DatabaseSync) {}

  record(
    turnId: string,
    harnessId: string,
    results: SkillProvisioningResult[]
  ): void {
    if (results.length === 0) return
    const insert = this.database.prepare(
      "INSERT OR REPLACE INTO skill_provisioning_reports (turn_id, root_id, harness_id, root_path, content_digest, status, method, message, attempted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    const attemptedAt = new Date().toISOString()
    transaction(this.database, () => {
      for (const result of results) {
        insert.run(
          turnId,
          result.rootId,
          harnessId,
          result.rootPath,
          result.contentDigest ?? null,
          result.status,
          result.method,
          result.message ?? null,
          attemptedAt
        )
      }
    })
  }

  latestForProject(projectId: string): Map<string, SkillProvisioningReport[]> {
    // SAFETY: migrations define every selected report column with the matching
    // SQLite scalar type; the JOIN only filters rows and adds no projections.
    const rows = this.database
      .prepare(
        "SELECT reports.* FROM skill_provisioning_reports reports JOIN turns ON turns.id = reports.turn_id JOIN threads ON threads.id = turns.thread_id WHERE threads.project_id = ? ORDER BY reports.attempted_at DESC"
      )
      .all(projectId) as SkillProvisioningRow[]
    const latest = new Map<string, SkillProvisioningReport[]>()
    const seen = new Set<string>()
    for (const row of rows) {
      const key = `${row.root_id}\0${row.harness_id}`
      if (seen.has(key)) continue
      seen.add(key)
      const reports = latest.get(row.root_id) ?? []
      reports.push(toReport(row))
      latest.set(row.root_id, reports)
    }
    return latest
  }
}

function toReport(row: SkillProvisioningRow): SkillProvisioningReport {
  const report: SkillProvisioningReport = {
    turnId: row.turn_id,
    rootId: row.root_id,
    harnessId: row.harness_id,
    rootPath: row.root_path,
    contentDigest: row.content_digest,
    status: row.status,
    method: row.method,
    attemptedAt: row.attempted_at,
  }
  if (row.message) report.message = row.message
  return report
}
