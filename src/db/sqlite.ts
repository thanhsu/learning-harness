import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export type Db = InstanceType<typeof Database>;

export function openDb(dataDir: string): Db {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new Database(path.join(dataDir, 'learning-harness.db'));
  db.pragma('journal_mode = WAL');
  migrate(db);
  return db;
}

/** In-memory database, used by tests. */
export function openMemoryDb(): Db {
  const db = new Database(':memory:');
  migrate(db);
  return db;
}

function migrate(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_calls (
      day   TEXT PRIMARY KEY,
      calls INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS processed_files (
      path         TEXT PRIMARY KEY,
      mtime_ms     INTEGER NOT NULL,
      note_path    TEXT,
      processed_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id          TEXT PRIMARY KEY,
      started_at  TEXT NOT NULL,
      ended_at    TEXT,
      chunk_count INTEGER NOT NULL DEFAULT 0,
      note_path   TEXT
    );
  `);
}
