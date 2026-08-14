import type { DatabaseSync } from "node:sqlite"

const migrations = [
  `
    CREATE TABLE workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      harness_id TEXT NOT NULL,
      status TEXT NOT NULL,
      provider_session_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE turns (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      prompt TEXT NOT NULL,
      status TEXT NOT NULL,
      provider_session_id TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      finished_at TEXT
    );

    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      turn_id TEXT REFERENCES turns(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      state TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE approvals (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      detail TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      resolved_at TEXT
    );

    CREATE INDEX threads_workspace_updated_idx ON threads(workspace_id, updated_at DESC);
    CREATE INDEX messages_thread_created_idx ON messages(thread_id, created_at);
    CREATE INDEX approvals_thread_status_idx ON approvals(thread_id, status);
  `,
  `ALTER TABLE messages ADD COLUMN error TEXT;`,
  `
    ALTER TABLE threads ADD COLUMN model_id TEXT;
    ALTER TABLE threads ADD COLUMN effort TEXT;
    ALTER TABLE threads ADD COLUMN permission_mode TEXT NOT NULL DEFAULT 'approval-required';

    ALTER TABLE turns ADD COLUMN model_id TEXT;
    ALTER TABLE turns ADD COLUMN effort TEXT;
    ALTER TABLE turns ADD COLUMN permission_mode TEXT NOT NULL DEFAULT 'approval-required';

    CREATE TABLE activities (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      detail TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      finished_at TEXT
    );

    CREATE INDEX activities_thread_created_idx ON activities(thread_id, created_at);
  `,
  `
    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `,
]

export function migrate(database: DatabaseSync): void {
  const currentVersion = database.prepare("PRAGMA user_version").get() as {
    user_version: number
  }

  for (
    let index = currentVersion.user_version;
    index < migrations.length;
    index += 1
  ) {
    database.exec("BEGIN IMMEDIATE")
    try {
      database.exec(migrations[index]!)
      database.exec(`PRAGMA user_version = ${index + 1}`)
      database.exec("COMMIT")
    } catch (error) {
      database.exec("ROLLBACK")
      throw error
    }
  }
}
