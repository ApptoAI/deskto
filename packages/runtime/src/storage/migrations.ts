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
  `
    ALTER TABLE threads ADD COLUMN last_user_message_at TEXT;
    ALTER TABLE threads ADD COLUMN last_turn_completed_at TEXT;
    ALTER TABLE threads ADD COLUMN last_visited_at TEXT;
    ALTER TABLE threads ADD COLUMN failed_at TEXT;
    ALTER TABLE threads ADD COLUMN pinned_at TEXT;
    ALTER TABLE threads ADD COLUMN snoozed_until TEXT;
    ALTER TABLE threads ADD COLUMN snoozed_at TEXT;
    ALTER TABLE threads ADD COLUMN done_override TEXT;
    ALTER TABLE threads ADD COLUMN done_at TEXT;

    UPDATE threads SET last_user_message_at = (
      SELECT MAX(created_at) FROM messages
      WHERE messages.thread_id = threads.id AND messages.role = 'user'
    );
    UPDATE threads SET last_turn_completed_at = (
      SELECT MAX(finished_at) FROM turns
      WHERE turns.thread_id = threads.id AND turns.status = 'completed'
    );
    -- Visits were never tracked before; without this backfill every existing
    -- task would light up as an unread completion.
    UPDATE threads SET last_visited_at = updated_at;
    -- Best available edge for tasks already failed when the column arrives.
    UPDATE threads SET failed_at = updated_at WHERE status = 'failed';
  `,
  `
    ALTER TABLE activities ADD COLUMN payload TEXT;
    ALTER TABLE activities ADD COLUMN parent_id TEXT;
    ALTER TABLE activities ADD COLUMN ordinal INTEGER;
    ALTER TABLE messages ADD COLUMN ordinal INTEGER;
  `,
  `
    ALTER TABLE turns ADD COLUMN prompt_references TEXT;
    ALTER TABLE messages ADD COLUMN prompt_references TEXT;
  `,
  `
    CREATE TABLE artifacts (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      relative_path TEXT NOT NULL,
      name TEXT NOT NULL,
      media_type TEXT NOT NULL,
      preview_kind TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (project_id, relative_path)
    );

    CREATE TABLE turn_outputs (
      turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
      artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      PRIMARY KEY (turn_id, artifact_id)
    );

    CREATE INDEX turn_outputs_artifact_created_idx
      ON turn_outputs(artifact_id, created_at DESC);
  `,
  `
    ALTER TABLE packs ADD COLUMN kind TEXT
      CHECK (kind IS NULL OR kind IN ('managed', 'linked'));
    ALTER TABLE packs ADD COLUMN content_digest TEXT;
    ALTER TABLE packs ADD COLUMN receipt_json TEXT;
  `,
  `
    CREATE TABLE skill_provisioning_reports (
      turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
      root_id TEXT NOT NULL,
      harness_id TEXT NOT NULL,
      root_path TEXT NOT NULL,
      content_digest TEXT,
      status TEXT NOT NULL CHECK (status IN ('configured', 'unsupported', 'failed')),
      method TEXT NOT NULL,
      message TEXT,
      attempted_at TEXT NOT NULL,
      PRIMARY KEY (turn_id, root_id)
    );

    CREATE INDEX skill_provisioning_project_latest_idx
      ON skill_provisioning_reports(root_id, harness_id, attempted_at DESC);
  `,
  `
    CREATE TABLE message_attachments (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK (type = 'image'),
      name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      data BLOB NOT NULL,
      sort_order INTEGER NOT NULL
    );

    CREATE INDEX message_attachments_message_idx
      ON message_attachments(message_id, sort_order);
  `,
  `
    ALTER TABLE threads ADD COLUMN parent_thread_id TEXT
      REFERENCES threads(id) ON DELETE CASCADE;

    CREATE INDEX threads_parent_updated_idx
      ON threads(parent_thread_id, updated_at DESC);

    CREATE VIRTUAL TABLE thread_search USING fts5(
      thread_id UNINDEXED,
      project_id UNINDEXED,
      title,
      content,
      tokenize = 'unicode61'
    );

    INSERT INTO thread_search (thread_id, project_id, title, content)
    SELECT
      threads.id,
      threads.project_id,
      threads.title,
      COALESCE((
        SELECT group_concat(messages.content, char(10))
        FROM messages
        WHERE messages.thread_id = threads.id
          AND messages.state <> 'streaming'
      ), '')
    FROM threads;

    CREATE TRIGGER thread_search_after_thread_insert
    AFTER INSERT ON threads BEGIN
      INSERT INTO thread_search (thread_id, project_id, title, content)
      VALUES (new.id, new.project_id, new.title, '');
    END;

    CREATE TRIGGER thread_search_after_thread_update
    AFTER UPDATE OF title, project_id ON threads BEGIN
      UPDATE thread_search
      SET title = new.title, project_id = new.project_id
      WHERE thread_id = new.id;
    END;

    CREATE TRIGGER thread_search_after_thread_delete
    AFTER DELETE ON threads BEGIN
      DELETE FROM thread_search WHERE thread_id = old.id;
    END;

    CREATE TRIGGER thread_search_after_message_insert
    AFTER INSERT ON messages BEGIN
      UPDATE thread_search
      SET content = content || char(10) ||
        CASE WHEN new.state = 'streaming' THEN '' ELSE new.content END
      WHERE thread_id = new.thread_id;
    END;

    CREATE TRIGGER thread_search_after_message_update
    AFTER UPDATE OF content, state ON messages
    WHEN new.state <> 'streaming' BEGIN
      UPDATE thread_search
      SET content = COALESCE((
        SELECT group_concat(messages.content, char(10))
        FROM messages
        WHERE messages.thread_id = new.thread_id
          AND messages.state <> 'streaming'
      ), '')
      WHERE thread_id = new.thread_id;
    END;

    CREATE TRIGGER thread_search_after_message_delete
    AFTER DELETE ON messages BEGIN
      UPDATE thread_search
      SET content = COALESCE((
        SELECT group_concat(messages.content, char(10))
        FROM messages
        WHERE messages.thread_id = old.thread_id
          AND messages.state <> 'streaming'
      ), '')
      WHERE thread_id = old.thread_id;
    END;
  `,
  `
    ALTER TABLE projects ADD COLUMN location_kind TEXT NOT NULL DEFAULT 'linked'
      CHECK (location_kind IN ('managed', 'linked'));
    ALTER TABLE projects ADD COLUMN instructions TEXT NOT NULL DEFAULT '';
    ALTER TABLE projects ADD COLUMN pinned_at TEXT;
    ALTER TABLE projects ADD COLUMN source_template_id TEXT;
    ALTER TABLE projects ADD COLUMN source_template_name TEXT;
    ALTER TABLE projects ADD COLUMN source_template_pack_name TEXT;

    CREATE INDEX projects_workspace_pinned_updated_idx
      ON projects(workspace_id, pinned_at DESC, updated_at DESC);
  `,
  `ALTER TABLE projects ADD COLUMN description TEXT NOT NULL DEFAULT '';`,
  `
    ALTER TABLE threads ADD COLUMN is_side INTEGER NOT NULL DEFAULT 0
      CHECK (is_side IN (0, 1));
    ALTER TABLE threads ADD COLUMN fork_provider_session INTEGER NOT NULL DEFAULT 0
      CHECK (fork_provider_session IN (0, 1));

    CREATE UNIQUE INDEX threads_one_side_idx
      ON threads(parent_thread_id) WHERE is_side = 1;
  `,
  `
    ALTER TABLE messages ADD COLUMN delivery_state TEXT
      CHECK (delivery_state IS NULL OR delivery_state IN ('queued', 'steering', 'steered'));

    CREATE TABLE follow_ups (
      message_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
      thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      harness_prompt TEXT NOT NULL,
      harness_references TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX follow_ups_thread_created_idx
      ON follow_ups(thread_id, created_at);
  `,
]

export function migrate(database: DatabaseSync): void {
  // SAFETY: PRAGMA user_version always returns one row with an integer
  // user_version field in SQLite.
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
