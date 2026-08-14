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
  `
    ALTER TABLE threads ADD COLUMN context_used_tokens INTEGER;
    ALTER TABLE threads ADD COLUMN context_max_tokens INTEGER;
  `,
  `
    ALTER TABLE workspaces RENAME TO projects;
    ALTER TABLE threads RENAME COLUMN workspace_id TO project_id;
    DROP INDEX threads_workspace_updated_idx;
    CREATE INDEX threads_project_updated_idx ON threads(project_id, updated_at DESC);
  `,
  `
    CREATE TABLE workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT NOT NULL,
      icon TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    INSERT INTO workspaces (id, name, color, icon, sort_order, created_at, updated_at)
    VALUES (
      'personal', 'Personal', 'slate', 'home', 0,
      strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    );

    CREATE TABLE projects_with_workspace (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      name TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    INSERT INTO projects_with_workspace (id, workspace_id, name, path, created_at, updated_at)
    SELECT id, 'personal', name, path, created_at, updated_at FROM projects;

    DROP TABLE projects;
    ALTER TABLE projects_with_workspace RENAME TO projects;
    CREATE INDEX projects_workspace_updated_idx ON projects(workspace_id, updated_at DESC);
  `,
  `
    CREATE TABLE packs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE workspace_packs (
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      pack_id TEXT NOT NULL REFERENCES packs(id) ON DELETE CASCADE,
      PRIMARY KEY (workspace_id, pack_id)
    );
  `,
  `
    UPDATE settings SET key = 'preferences.lastProfile.personal'
    WHERE key = 'preferences.lastProfile'
      AND NOT EXISTS (
        SELECT 1 FROM settings WHERE key = 'preferences.lastProfile.personal'
      );
    DELETE FROM settings WHERE key = 'preferences.lastProfile';
  `,
  `
    ALTER TABLE messages ADD COLUMN failure_kind TEXT;
    ALTER TABLE messages ADD COLUMN failure_reset_at TEXT;
    ALTER TABLE turns ADD COLUMN failure_kind TEXT;
    ALTER TABLE turns ADD COLUMN failure_reset_at TEXT;
  `,
]

export function migrate(database: DatabaseSync): void {
  const currentVersion = database.prepare("PRAGMA user_version").get() as {
    user_version: number
  }
  if (currentVersion.user_version >= migrations.length) return

  // Foreign keys stay off for the whole run: a table rebuild drops the old
  // table, and with enforcement on that DROP would cascade into dependents.
  // Every batch is checked before commit instead.
  database.exec("PRAGMA foreign_keys = OFF")
  try {
    for (
      let index = currentVersion.user_version;
      index < migrations.length;
      index += 1
    ) {
      database.exec("BEGIN IMMEDIATE")
      try {
        database.exec(migrations[index]!)
        const violations = database.prepare("PRAGMA foreign_key_check").all()
        if (violations.length > 0)
          throw new Error(`Migration ${index} violates foreign keys`)
        database.exec(`PRAGMA user_version = ${index + 1}`)
        database.exec("COMMIT")
      } catch (error) {
        database.exec("ROLLBACK")
        throw error
      }
    }
  } finally {
    database.exec("PRAGMA foreign_keys = ON")
  }
}
