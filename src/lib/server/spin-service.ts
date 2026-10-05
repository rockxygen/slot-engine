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
import type { GameConfig } from '@/lib/engine/types'
import {
  CURRENT_CONFIG_HASH,
  ensureConfigSnapshot,
  resolveReplayConfig,
} from './config-versions'
import { creditIf, getBalance, getSession } from './wallet'
import { entropyStatus } from './entropy'
import { checkLimits, getLimits, limitUsage, type LimitId } from './limits'
import { kycGate, type KycGateResult } from './accounts'

/// ────────────────────────────────── determinizm / denetim yardımcıları

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

export { CURRENT_CONFIG_HASH }

export function roundHash(round: SpinRound): string {
  return sha256(JSON.stringify(round))
}

/**
 * Faz 9 ÖNCESİ tur şekli — `jackpot` alanı olmadan üretilmiş JSON.
 * Eski kayıtlar bu hâlde hash'lendi (round anahtarı sırası: bet, base,
 * link, freeSpins, totalWin). Yeni koddan replay edilen eski tur,
 * şekle normalize edilerek AYNI hash'e ulaşır → denetim geçmişe
 * dokunmadan doğrulanmaya devam eder.
 */
export function legacyRoundHash(round: SpinRound): string {
  return sha256(
    JSON.stringify({
      bet: round.bet,
      base: round.base,
      link: round.link,
      freeSpins: round.freeSpins,
      totalWin: round.totalWin,
    }),
  )
}

/**
 * Faz 9 tur şekli — `jackpot` VAR ama `bell` YOK (Faz 10 öncesi).
 * Faz 9 ile 10 arasında oynanmış kayıtlar bu JSON şekliyle hash'lendi
 * (anahtar sırası: bet, base, jackpot, link, freeSpins, totalWin).
 */
export function faz9RoundHash(round: SpinRound): string {
  return sha256(
    JSON.stringify({
      bet: round.bet,
      base: round.base,
      jackpot: round.jackpot,
      link: round.link,
      freeSpins: round.freeSpins,
      totalWin: round.totalWin,
    }),
  )
}

/// Replay çıktısı, kayıtlı hash'in GÜNCEL ya da tarihsel şekillerinden
/// biriyle eşleşiyorsa doğrulanmıştır (alan eklendikçe liste büyür).
export function matchesRoundHash(replayed: SpinRound, storedHash: string): boolean {
  return (
    roundHash(replayed) === storedHash ||
    faz9RoundHash(replayed) === storedHash ||
    legacyRoundHash(replayed) === storedHash
  )
}

/**
 * Denetçi replay'i: seed ile tur YENİDEN üretilir, hash karşılaştırılır.
 * Kayıt = sonuç DEĞİL, yeniden-üretilebilir kanıttır.
 *
 * `config` verilmez (veya round'ın hash'i verilirse `replayRoundConfig`)
 * o turun OYNANDIĞI matematik kullanılır — config değişse bile eski
 * turlar snapshot ile replay edilebilir (Faz 6).
 */
export function replayRound(
  seed: string,
  bet: number,
  config: GameConfig = CLOVER_LINK_BELLS,
): SpinRound {
  return playRound(config, createRng(seed), bet)
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
  // Turun OYNANDIĞI config ile replay et (güncel binary veya snapshot)
  const resolved = resolveReplayConfig(row.config_hash)
  if (!resolved) return { ok: false, row } // config kaybı → doğrulanamaz
  const replayed = replayRound(row.seed, row.bet, resolved.config)
  return { ok: matchesRoundHash(replayed, row.round_hash), row }
}

/// Kayıtlı turu OYNANDIĞI config ile yeniden üretir (idempotent
/// yanıt): eski config snapshot'ı varsa onunla, yoksa güncelle.
/// (Yanıt daima ledger'daki turun kendisi olmalı — bet/win değişmez.)
function replayStored(row: RoundRow): SpinRound {
  const resolved = resolveReplayConfig(row.config_hash)
  return replayRound(row.seed, row.bet, resolved?.config ?? CLOVER_LINK_BELLS)
}

/// ────────────────────────────────── spin servisi

export type SpinFailureReason =
  | 'invalid_bet'
  | 'insufficient_balance'
  | 'request_conflict'
  | 'force_not_allowed'
  | 'rng_unhealthy'
  | 'limit_exceeded'
  | 'kyc_required'

export type SpinOutcome =
  | { ok: true; round: SpinRound; balance: number; roundId: number }
  | {
      ok: false
      reason: SpinFailureReason
      limit?: LimitId
      kyc?: KycGateResult
    }

export interface PerformSpinOptions {
  sessionId: string
  bet: number
  clientRequestId: string
  force?: SpinForce | null
  /// QA kapısı: route NODE_ENV/env'den geçirir; gerçek para kapalıdır
  allowForce?: boolean
  /// KYC politikası (route: `SLOT_REQUIRE_KYC=1`): anonim oturumlar da
  /// doğrulanmış hesaba bağlı olmalı. Varsayılan false = anonim demo serbest.
  requireAccount?: boolean
}

/// Bonus turlu seed araması (demo QA). Seed'ler deterministiktir:
/// `force-link-0`, `force-link-1` … Motoru DEĞİL, geçerli turlar
/// arasından SEÇİM yapar. Bulamazsa null → çağırıcı normal seed kullanır.
/// Pencere, tetik olasılığına göre (1−p)^N ≈ %99.9+ bulma oranı):
/// jackpot ~1/10.000 → 100K · çan ~1/4.049 (Faz 10 ölçümü) → 30K ·
/// link ~1/344, fs ~1/141 → 4K.
function findForceSeed(
  force: SpinForce,
  bet: number,
  attempts =
    force === 'jackpot'
      ? 100_000
      : force === 'bell'
        ? 30_000
        : 4000,
): string | null {
  for (let i = 0; i < attempts; i++) {
    const seed = `force-${force}-${i}`
    const round = playRound(CLOVER_LINK_BELLS, createRng(seed), bet)
    const hit =
      force === 'link'
        ? round.link
        : force === 'bell'
          ? round.bell
          : force === 'fs'
            ? round.freeSpins
            : round.jackpot
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
/// Bu süreçte snapshot garanti edildi mi? (round yazımından önce bir kez)
let snapshotEnsured = false

export function performSpin(
  db: DatabaseSync,
  opts: PerformSpinOptions,
): SpinOutcome {
  const { sessionId, clientRequestId, force = null, allowForce = false } = opts
  const bet = opts.bet

  // Config snapshot'ını ilk turda materyalize et: bu binary'nin
  // matematiği ileride (config değişse bile) denetlenebilir kalsın.
  if (!snapshotEnsured) {
    snapshotEnsured = true
    try {
      ensureConfigSnapshot()
    } catch (err) {
      console.error('config snapshot yazılamadı (tur etkilenmedi):', err)
    }
  }

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
      round: replayStored(existing),
      balance: getBalance(db, sessionId),
      roundId: existing.id,
    }
  }

  // 1b) KYC kapısı (Faz 7 · §7): YENİ tur üretmeden önce kimlik
  //     doğrulanmış olmalı. İdempotent replay burayı GEÇER — bahis
  //     zaten alınmış, sonucu sahiplenmek kimlik gerektirmez.
  const requireAccount = opts.requireAccount ?? false
  const kyc = kycGate(db, sessionId, requireAccount)
  if (kyc !== 'ok') {
    return { ok: false, reason: 'kyc_required', kyc }
  }

  // 2) RNG sağlığı (entropi kaynağı): YENİ seed üretmeden ÖNCE dur —
  //    sağlık testi başarısızsa oyun oynatılmaz (GLI-19 tipi şart).
  //    Mevcut turun idempotent replay'i seed üretmez → engellenmez.
  const health = entropyStatus()
  if (!health.ok) {
    return { ok: false, reason: 'rng_unhealthy' }
  }

  // 2a) Sorumlu oyun limitleri: YENİ tur kabul edilmeden önce (kayıp/
  //     ciro/süre). İhlal → hiçbir yazılmaz, para hareketi olmaz.
  //     Limitler NULL ise (demo varsayılanı) bu kontrol hemen geçer.
  const usage = limitUsage(db, sessionId)
  const violated = checkLimits(getLimits(db, sessionId), usage, bet)
  if (violated) {
    return { ok: false, reason: 'limit_exceeded', limit: violated }
  }

  // 2b) Force kapısı (demo QA)
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
        CURRENT_CONFIG_HASH,
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
        round: replayStored(dup),
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
