import type { DatabaseSync } from 'node:sqlite'

/// Demo başlangıç bakiyesi — gerçek para modunda yerini DEPozito alır.
export const START_BALANCE = 50_000 // 500,00 ₺

export type LedgerKind = 'OPENING' | 'BET' | 'WIN' | 'REFILL'

export interface SessionRow {
  id: string
  balance: number
}

export interface LedgerRow {
  id: number
  kind: LedgerKind
  amount: number
  balance_after: number
  round_id: number | null
  created_at: number
}

/// Yeni oturum (cüzdan) açar. Açılış bakiyesi de LEDGER'a yazılır —
/// denetçi için invariant: her oturumda `SUM(amount) == balance`.
/// Demo kimliği cookie'dedir; gerçek para modunda yerini hesap/KYC
/// kimliği alır.
export function createSession(
  db: DatabaseSync,
  id: string,
  balance: number = START_BALANCE,
): SessionRow {
  db.prepare(
    'INSERT INTO sessions (id, balance, created_at) VALUES (?, ?, ?)',
  ).run(id, balance, Date.now())
  insertLedger(db, id, 'OPENING', balance, balance)
  return { id, balance }
}

export function getSession(db: DatabaseSync, id: string): SessionRow | null {
  const row = db
    .prepare('SELECT id, balance FROM sessions WHERE id = ?')
    .get(id) as { id: string; balance: number } | undefined
  return row ? { id: row.id, balance: row.balance } : null
}

export function getBalance(db: DatabaseSync, id: string): number {
  const row = getSession(db, id)
  if (!row) throw new Error(`session yok: ${id}`)
  return row.balance
}

/**
 * Koşullu bakiye ARTIŞI + denetim izi (çekirdek ledger deseni).
 *
 * `expected` ile yarış güvenliği: bakiye bu arada değiştiyse yazmaz ve
 * `null` döner — çağıran rollback (throw) ile iptal eder. Her satırda
 * `balance_after` saklanır; denetçi `SUM(amount) = balance` invariantını
 * oturtabilir. Dönüş: bu hareketin ledger SATIR ID'si (başarısızsa null).
 */
export function creditIf(
  db: DatabaseSync,
  sessionId: string,
  expected: number,
  amount: number,
  kind: LedgerKind,
  roundId: number | null = null,
): number | null {
  const next = expected + amount
  if (next < 0) return null
  const updated = db
    .prepare(
      'UPDATE sessions SET balance = ? WHERE id = ? AND balance = ?',
    )
    .run(next, sessionId, expected)
  if (Number(updated.changes) !== 1) return null
  return insertLedger(db, sessionId, kind, amount, next, roundId)
}

export function insertLedger(
  db: DatabaseSync,
  sessionId: string,
  kind: LedgerKind,
  amount: number,
  balanceAfter: number,
  roundId: number | null = null,
): number {
  const res = db
    .prepare(
      `INSERT INTO ledger (session_id, kind, amount, balance_after, round_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(sessionId, kind, amount, balanceAfter, roundId, Date.now())
  return Number(res.lastInsertRowid)
}

export function listLedger(
  db: DatabaseSync,
  sessionId: string,
): LedgerRow[] {
  return db
    .prepare(
      `SELECT id, kind, amount, balance_after, round_id, created_at
       FROM ledger WHERE session_id = ? ORDER BY id`,
    )
    .all(sessionId) as unknown as LedgerRow[]
}

/// Denetim invariantı: hareket toplamı == bakiye
export function ledgerSum(db: DatabaseSync, sessionId: string): number {
  const row = db
    .prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM ledger WHERE session_id = ?')
    .get(sessionId) as { total: number }
  return row.total
}

/// Demo yenileme: START_BALANCE altındaysa eksik kadar REFILL yazar.
export function refillDemo(db: DatabaseSync, sessionId: string): number {
  const current = getBalance(db, sessionId)
  if (current >= START_BALANCE) return current
  const ok = creditIf(db, sessionId, current, START_BALANCE - current, 'REFILL')
  if (ok === null) throw new Error('refill yarışta kaldı') // tek süreçte imkânsız
  return START_BALANCE
}
