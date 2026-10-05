import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/// SQLite şeması v1 — denetim (audit) için ek-ücretli kural:
/// • ledger: her bakiye hareketi + hareket SONRASI bakiye (denetim izi)
/// • rounds: seed + hash → denetçi replay edip SONUCU YENİDEN ÜRETEBİLİR
/// • rounds: (session, client_request_id) UNIQUE → idempotency (double-bet yok)
const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  balance    INTEGER NOT NULL CHECK (balance >= 0),
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rounds (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id        TEXT NOT NULL REFERENCES sessions(id),
  client_request_id TEXT NOT NULL,
  seed              TEXT NOT NULL,
  bet               INTEGER NOT NULL,
  win               INTEGER NOT NULL,
  balance_after     INTEGER NOT NULL,
  round_hash        TEXT NOT NULL,
  config_hash       TEXT NOT NULL,
  forced            TEXT,
  created_at        INTEGER NOT NULL,
  UNIQUE (session_id, client_request_id)
);

CREATE TABLE IF NOT EXISTS ledger (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id     TEXT NOT NULL REFERENCES sessions(id),
  kind           TEXT NOT NULL CHECK (kind IN ('OPENING', 'BET', 'WIN', 'REFILL')),
  amount         INTEGER NOT NULL,
  balance_after  INTEGER NOT NULL,
  round_id       INTEGER REFERENCES rounds(id),
  created_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS players (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  kyc_status    TEXT NOT NULL DEFAULT 'pending'
                  CHECK (kyc_status IN ('pending', 'verified', 'rejected')),
  created_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ledger_session ON ledger(session_id, id);
PRAGMA user_version = 1;
`

/// Sürüm migrasyonu: sonraki fazların sütunları mevcut DB'lere eklenir.
/// Sütun-varlık kontrolü idempotent — eski/yeni DB aynı şemaya oturur.
function ensureColumns(db: DatabaseSync): void {
  const cols = new Set(
    (
      db.prepare('PRAGMA table_info(sessions)').all() as { name: string }[]
    ).map((c) => c.name),
  )
  // Faz 7b: sorumlu oyun limitleri (NULL = limit yok)
  if (!cols.has('loss_limit'))
    db.exec('ALTER TABLE sessions ADD COLUMN loss_limit INTEGER')
  if (!cols.has('spend_limit'))
    db.exec('ALTER TABLE sessions ADD COLUMN spend_limit INTEGER')
  if (!cols.has('session_limit_sec'))
    db.exec('ALTER TABLE sessions ADD COLUMN session_limit_sec INTEGER')
  // Faz 7e: oturum → oyuncu bağı (NULL = anonim demo oturumu)
  if (!cols.has('player_id'))
    db.exec('ALTER TABLE sessions ADD COLUMN player_id TEXT')
}

/// Testler ve üretim AYNI kodu kullanır: `:memory:` veya dosya.
export function openDb(path: string): DatabaseSync {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true })
  }
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL;')
  db.exec('PRAGMA foreign_keys = ON;')
  db.exec('PRAGMA busy_timeout = 5000;')
  db.exec(SCHEMA)
  ensureColumns(db)
  return db
}

/// Uygulama tekil bağlantısı — globalThis üzerinde tutulur ki Next dev
/// hot-reload yeni bağlantı yığmasın.
const DB_KEY = Symbol.for('slot-engine.db')

export function getDb(): DatabaseSync {
  const g = globalThis as unknown as Record<symbol, DatabaseSync | undefined>
  if (!g[DB_KEY]) {
    const path =
      process.env.SLOT_DB_PATH ?? join(process.cwd(), '.data', 'slot.db')
    g[DB_KEY] = openDb(path)
  }
  return g[DB_KEY]
}
