import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import {
  ALLOWED_BETS,
  type SpinForce,
} from '@/lib/api-types'
import {
  CLOVER_LINK_BELLS,
  createRng,
  playRound,
  randomSeed,
  type SpinRound,
} from '@/lib/engine'
import { creditIf, getBalance, getSession } from './wallet'

/// ────────────────────────────────── determinizm / denetim yardımcıları

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/// Oyun VERİSİ'nin parmak izi — config değişince denetçi satırları
/// hangi matematikle üretildiğini ayırt edebilir.
const CONFIG_HASH = sha256(JSON.stringify(CLOVER_LINK_BELLS))

export function roundHash(round: SpinRound): string {
  return sha256(JSON.stringify(round))
}

/// Denetçi replay'i: kayıtlı seed ile tur YENİDEN üretilir, hash
/// karşılaştırılır. Kayıt = sonuç DEĞİL, yeniden-üretilebilir kanıttır.
export function replayRound(seed: string, bet: number): SpinRound {
  return playRound(CLOVER_LINK_BELLS, createRng(seed), bet)
}

export interface RoundRow {
  id: number
  session_id: string
  client_request_id: string
  seed: string
  bet: number
  win: number
  balance_after: number
  round_hash: string
  config_hash: string
  forced: string | null
  created_at: number
}

export function verifyRound(
  db: DatabaseSync,
  roundId: number,
): { ok: boolean; row: RoundRow | null } {
  const row = db
    .prepare('SELECT * FROM rounds WHERE id = ?')
    .get(roundId) as RoundRow | undefined
  if (!row) return { ok: false, row: null }
  const replayed = replayRound(row.seed, row.bet)
  return { ok: roundHash(replayed) === row.round_hash, row }
}

/// ────────────────────────────────── spin servisi

export type SpinFailureReason =
  | 'invalid_bet'
  | 'insufficient_balance'
  | 'request_conflict'
  | 'force_not_allowed'

export type SpinOutcome =
  | { ok: true; round: SpinRound; balance: number; roundId: number }
  | { ok: false; reason: SpinFailureReason }

export interface PerformSpinOptions {
  sessionId: string
  bet: number
  clientRequestId: string
  force?: SpinForce | null
  /// QA kapısı: route NODE_ENV/env'den geçirir; gerçek para kapalıdır
  allowForce?: boolean
}

/// Bonus turlu seed araması (demo QA). Seed'ler deterministiktir:
/// `force-link-0`, `force-link-1` … Motoru DEĞİL, geçerli turlar
/// arasından SEÇİM yapar. Bulamazsa null → çağırıcı normal seed kullanır.
function findForceSeed(
  force: SpinForce,
  bet: number,
  attempts = 4000,
): string | null {
  for (let i = 0; i < attempts; i++) {
    const seed = `force-${force}-${i}`
    const round = playRound(CLOVER_LINK_BELLS, createRng(seed), bet)
    const hit = force === 'link' ? round.link : round.freeSpins
    if (hit) return seed
  }
  return null
}

/**
 * OTORİTER TUR — sunucuda tek giriş noktası.
 *
 * Sözleşme:
 * 1) İdempotency: aynı (session, clientRequestId) → kayıtlı seed'den
 *    replay edilir; İKİNCİ KEZ bahis çekilmez (ağ tekrarı güvenliği).
 * 2) Her tur SYNCHRONOUS bir SQLite transaction'ı içinde yürür
 *    (BET çek → round kaydet → WIN öde) — ara `await` yok, yani tek
 *    süreçte parçalanamaz; hata → ROLLBACK, hiçbir iz kalmaz.
 * 3) Sonuç `SpinRound` + gerçek bakiyedir; istemci yalnızca oynatır.
 */
export function performSpin(
  db: DatabaseSync,
  opts: PerformSpinOptions,
): SpinOutcome {
  const { sessionId, clientRequestId, force = null, allowForce = false } = opts
  const bet = opts.bet

  if (!Number.isInteger(bet) || !ALLOWED_BETS.some((b) => b === bet)) {
    return { ok: false, reason: 'invalid_bet' }
  }

  // 1) İdempotency kontrolü
  const existing = db
    .prepare(
      'SELECT * FROM rounds WHERE session_id = ? AND client_request_id = ?',
    )
    .get(sessionId, clientRequestId) as RoundRow | undefined
  if (existing) {
    if (existing.bet !== bet) return { ok: false, reason: 'request_conflict' }
    return {
      ok: true,
      round: replayRound(existing.seed, existing.bet),
      balance: getBalance(db, sessionId),
      roundId: existing.id,
    }
  }

  // 2) Force kapısı (demo QA)
  let seed: string
  if (force) {
    if (!allowForce) return { ok: false, reason: 'force_not_allowed' }
    seed = findForceSeed(force, bet) ?? randomSeed()
  } else {
    seed = randomSeed()
  }

  // 3) Bakiye kontrolü
  const session = getSession(db, sessionId)
  if (!session) throw new Error(`session yok: ${sessionId}`)
  if (session.balance < bet) {
    return { ok: false, reason: 'insufficient_balance' }
  }

  // 4) Saf motor — buraya kadar DAHI hiçbir yazılmadı
  const round = playRound(CLOVER_LINK_BELLS, createRng(seed), bet)

  // 5) Atomik kayıt: BET → round → WIN
  db.exec('BEGIN IMMEDIATE')
  try {
    const afterBet = session.balance - bet
    const betLedgerId = creditIf(db, sessionId, session.balance, -bet, 'BET')
    if (betLedgerId === null) throw new Error('BET debit başarısız')

    const finalBalance = afterBet + round.totalWin
    const ins = db
      .prepare(
        `INSERT INTO rounds
           (session_id, client_request_id, seed, bet, win, balance_after,
            round_hash, config_hash, forced, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        sessionId,
        clientRequestId,
        seed,
        bet,
        round.totalWin,
        finalBalance,
        roundHash(round),
        CONFIG_HASH,
        force,
        Date.now(),
      )
    const roundId = Number(ins.lastInsertRowid)

    // WIN satırı (0 kazançta yok — ledger yalnızca parayı izler)
    if (round.totalWin > 0) {
      const winLedgerId = creditIf(
        db,
        sessionId,
        afterBet,
        round.totalWin,
        'WIN',
        roundId,
      )
      if (winLedgerId === null) throw new Error('WIN credit başarısız')
    }

    // BET ledger satırını tura bağla (tam denetim izi)
    db.prepare('UPDATE ledger SET round_id = ? WHERE id = ?').run(
      roundId,
      betLedgerId,
    )

    db.exec('COMMIT')
    return { ok: true, round, balance: finalBalance, roundId }
  } catch (err) {
    db.exec('ROLLBACK')
    // Yarış/ihtiyat: UNIQUE ihlali bu arada oluştuysa idempotency'ye dön
    const dup = db
      .prepare(
        'SELECT * FROM rounds WHERE session_id = ? AND client_request_id = ?',
      )
      .get(sessionId, clientRequestId) as RoundRow | undefined
    if (dup && dup.bet === bet) {
      return {
        ok: true,
        round: replayRound(dup.seed, dup.bet),
        balance: getBalance(db, sessionId),
        roundId: dup.id,
      }
    }
    throw err
  }
}

/// Round kayıtlarını listeler (denetim/audit araçları için).
export function listRounds(
  db: DatabaseSync,
  sessionId: string,
): RoundRow[] {
  return db
    .prepare('SELECT * FROM rounds WHERE session_id = ? ORDER BY id')
    .all(sessionId) as unknown as RoundRow[]
}
