import type { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { openDb } from './db'
import {
  checkLimits,
  getLimits,
  limitUsage,
  setLimits,
} from './limits'
import { performSpin } from './spin-service'
import { createSession, getBalance, listLedger } from './wallet'

/// Sorumlu oyun limitleri (Faz 7 · §7): kayıp/ciro/süre SUNUCUDA
/// zorlanır; ihlalde tur yazılmaz, para hareketi olmaz (iz yok).

const SESSION = 'limits-sess-1'

/// Deterministik kullanım üretir: gerçek tur kaydı + EŞLEŞEN ledger
/// satırları (invariant bozulmaz — denetim temiz kalır).
function seedRound(
  db: DatabaseSync,
  sessionId: string,
  seq: number,
  bet: number,
  win: number,
): void {
  const now = Date.now()
  const s = db
    .prepare('SELECT balance FROM sessions WHERE id = ?')
    .get(sessionId) as { balance: number }
  const afterBet = s.balance - bet
  const after = afterBet + win

  const ins = db
    .prepare(
      `INSERT INTO rounds
         (session_id, client_request_id, seed, bet, win, balance_after,
          round_hash, config_hash, forced, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
    )
    .run(
      sessionId,
      `seeded-req-${seq}`,
      `seeded-${seq}`,
      bet,
      win,
      after,
      `hash-${seq}`,
      'test-config',
      now,
    )
  const roundId = Number(ins.lastInsertRowid)

  db.prepare(
    `INSERT INTO ledger (session_id, kind, amount, balance_after, round_id, created_at)
     VALUES (?, 'BET', ?, ?, ?, ?)`,
  ).run(sessionId, -bet, afterBet, roundId, now)
  if (win > 0) {
    db.prepare(
      `INSERT INTO ledger (session_id, kind, amount, balance_after, round_id, created_at)
       VALUES (?, 'WIN', ?, ?, ?, ?)`,
    ).run(sessionId, win, after, roundId, now)
  }
  db.prepare('UPDATE sessions SET balance = ? WHERE id = ?').run(
    after,
    sessionId,
  )
}

function freshDb(): DatabaseSync {
  const db = openDb(':memory:')
  createSession(db, SESSION)
  return db
}

describe('sorumlu oyun limitleri (Faz 7)', () => {
  it('setLimits: doğrulama — null=serbest, geçersiz değer RangeError', () => {
    const db = freshDb()
    expect(getLimits(db, SESSION)).toEqual({
      lossLimit: null,
      spendLimit: null,
      sessionLimitSec: null,
    })

    const set = setLimits(db, SESSION, { lossLimit: 5000 })
    expect(set.lossLimit).toBe(5000)
    // PATCH: diğerleri korunur
    expect(set.spendLimit).toBeNull()

    expect(() => setLimits(db, SESSION, { lossLimit: 0 })).toThrow(RangeError)
    expect(() => setLimits(db, SESSION, { lossLimit: -100 })).toThrow(
      RangeError,
    )
    expect(() => setLimits(db, SESSION, { spendLimit: 12.5 })).toThrow(
      RangeError,
    )
    expect(() => setLimits(db, SESSION, { sessionLimitSec: 1e12 })).toThrow(
      RangeError,
    )
    // null → temizle
    expect(setLimits(db, SESSION, { lossLimit: null }).lossLimit).toBeNull()
  })

  it('checkLimits: ihlal matrisi (eşikler dahil)', () => {
    const usage = { netLoss: 500, spend: 2000, playSeconds: 600 }
    expect(checkLimits({ lossLimit: null, spendLimit: null, sessionLimitSec: null }, usage, 500)).toBeNull()
    expect(checkLimits({ lossLimit: 500, spendLimit: null, sessionLimitSec: null }, usage, 100)).toBe('loss_limit')
    expect(checkLimits({ lossLimit: 501, spendLimit: null, sessionLimitSec: null }, usage, 100)).toBeNull()
    expect(checkLimits({ lossLimit: null, spendLimit: 2099, sessionLimitSec: null }, usage, 100)).toBe('spend_limit') // 2000+100 > 2099
    expect(checkLimits({ lossLimit: null, spendLimit: 2100, sessionLimitSec: null }, usage, 100)).toBeNull() // tam eşitlik: serbest (yalnız AŞMA bloklar)
    expect(checkLimits({ lossLimit: null, spendLimit: null, sessionLimitSec: 600 }, usage, 100)).toBe('session_time')
    expect(checkLimits({ lossLimit: null, spendLimit: null, sessionLimitSec: 601 }, usage, 100)).toBeNull()
    // Kazançlı oturumda kayıp limiti tetiklenmez
    expect(
      checkLimits(
        { lossLimit: 100, spendLimit: null, sessionLimitSec: null },
        { netLoss: -500, spend: 1000, playSeconds: 0 },
        200,
      ),
    ).toBeNull()
  })

  it('limitUsage: round tablosundan türetilir (netLoss = bet − win)', () => {
    const db = freshDb()
    seedRound(db, SESSION, 1, 1000, 400)
    seedRound(db, SESSION, 2, 500, 0)
    const u = limitUsage(db, SESSION)
    expect(u.spend).toBe(1500)
    expect(u.netLoss).toBe(1100)
    expect(u.playSeconds).toBeGreaterThanOrEqual(0)
  })

  it('kayıp limiti → tur RET, iz YOK (bakiye + ledger aynı kalır)', () => {
    const db = freshDb()
    seedRound(db, SESSION, 1, 1000, 0) // netLoss = 1000
    setLimits(db, SESSION, { lossLimit: 500 })
    const balance = getBalance(db, SESSION)
    const ledgerLen = listLedger(db, SESSION).length

    const out = performSpin(db, {
      sessionId: SESSION,
      bet: 200,
      clientRequestId: 'limits-req-0001',
    })
    expect(out).toEqual({
      ok: false,
      reason: 'limit_exceeded',
      limit: 'loss_limit',
    })
    expect(getBalance(db, SESSION)).toBe(balance)
    expect(listLedger(db, SESSION)).toHaveLength(ledgerLen)
    // Aynı istek tekrar = hâlâ bloklu (idempotency değil, limit)
    const again = performSpin(db, {
      sessionId: SESSION,
      bet: 200,
      clientRequestId: 'limits-req-0001',
    })
    expect(again.ok).toBe(false)
  })

  it('ciro limiti → bu bahis limiti aşarsa RET (aşmıyorsa geçer)', () => {
    const db = freshDb()
    setLimits(db, SESSION, { spendLimit: 150 })
    // İlk tur: 0 + 100 ≤ 150 → geçer
    const first = performSpin(db, {
      sessionId: SESSION,
      bet: 100,
      clientRequestId: 'limits-req-0002',
    })
    expect(first.ok).toBe(true)
    // İkinci tur: spend 100 + 100 = 200 > 150 → blok
    const second = performSpin(db, {
      sessionId: SESSION,
      bet: 100,
      clientRequestId: 'limits-req-0003',
    })
    expect(second).toEqual({
      ok: false,
      reason: 'limit_exceeded',
      limit: 'spend_limit',
    })
  })

  it('oturum süresi limiti → açılıştan itibaren süre aşılırsa RET', () => {
    const db = freshDb()
    setLimits(db, SESSION, { sessionLimitSec: 60 })
    // Açılışı 2 dakika geriye al
    db.prepare('UPDATE sessions SET created_at = ? WHERE id = ?').run(
      Date.now() - 120_000,
      SESSION,
    )
    const out = performSpin(db, {
      sessionId: SESSION,
      bet: 200,
      clientRequestId: 'limits-req-0004',
    })
    expect(out).toEqual({
      ok: false,
      reason: 'limit_exceeded',
      limit: 'session_time',
    })
  })

  it('limit yokken (demo varsayılanı NULL) oyun engellenmez', () => {
    const db = freshDb()
    seedRound(db, SESSION, 1, 1000, 0) // netLoss 1000 — limit olsaydı çoktan yakardı
    const out = performSpin(db, {
      sessionId: SESSION,
      bet: 200,
      clientRequestId: 'limits-req-0005',
    })
    expect(out.ok).toBe(true)
  })
})
