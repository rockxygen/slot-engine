import type { DatabaseSync } from 'node:sqlite'
import type { ApiErrorCode } from '@/lib/api-types'
import { CURRENT_CONFIG_HASH } from './config-versions'

/// ─────────────────────────────────── telemetri (Faz 6)
///
/// İki katman:
///  • SÜREÇ sayaçları — DB'ye gitmeyen olaylar (reddetmeler, bonus
///    tetikleri, son tur zamanı); yeniden başlatmada sıfırlanır.
///  • TÜM ZAMANLAR — SQLite round/sessions tablolarından türetilir;
///    kaynağı denetim ledger'ıdır, yeniden başlatmadan etkilenmez.

interface ProcessCounters {
  startedAt: number
  spins: number
  winRounds: number
  linkTriggers: number
  fsTriggers: number
  betTotal: number
  winTotal: number
  lastSpinAt: number | null
  rejections: Partial<Record<ApiErrorCode, number>>
}

const counters: ProcessCounters = {
  startedAt: Date.now(),
  spins: 0,
  winRounds: 0,
  linkTriggers: 0,
  fsTriggers: 0,
  betTotal: 0,
  winTotal: 0,
  lastSpinAt: null,
  rejections: {},
}

/// Route handler'dan: başarılı tur
export function recordSpin(e: {
  readonly bet: number
  readonly win: number
  readonly hasLink: boolean
  readonly hasFs: boolean
}): void {
  counters.spins++
  counters.betTotal += e.bet
  counters.winTotal += e.win
  if (e.win > 0) counters.winRounds++
  if (e.hasLink) counters.linkTriggers++
  if (e.hasFs) counters.fsTriggers++
  counters.lastSpinAt = Date.now()
}

/// Route handler'dan: reddedilen istek (para HAREKETİ olmadı)
export function recordReject(code: ApiErrorCode): void {
  counters.rejections[code] = (counters.rejections[code] ?? 0) + 1
}

export interface TelemetryReport {
  readonly now: string
  readonly uptimeSec: number
  readonly configHash: string
  /// Bu sürecin sayaçları (yeniden başlatmada sıfırlanır)
  readonly process: {
    readonly spins: number
    readonly winRounds: number
    readonly linkTriggers: number
    readonly fsTriggers: number
    readonly betTotal: number
    readonly winTotal: number
    readonly rtp: number | null
    readonly lastSpinAt: string | null
    readonly rejections: Readonly<Record<string, number>>
  }
  /// Denetim DB'sinden türetilen tüm zamanlar
  readonly allTime: {
    readonly sessions: number
    readonly rounds: number
    readonly forcedRounds: number
    readonly winRounds: number
    readonly betTotal: number
    readonly winTotal: number
    readonly rtp: number | null
    readonly lastRoundAt: string | null
  }
}

const iso = (ms: number | null): string | null =>
  ms ? new Date(ms).toISOString() : null

export function telemetryReport(db: DatabaseSync): TelemetryReport {
  const money = db
    .prepare(
      `SELECT COUNT(*) AS rounds,
              COALESCE(SUM(bet), 0) AS bet,
              COALESCE(SUM(win), 0) AS win,
              COALESCE(SUM(CASE WHEN win > 0 THEN 1 ELSE 0 END), 0) AS winRounds,
              COALESCE(SUM(CASE WHEN forced IS NOT NULL THEN 1 ELSE 0 END), 0) AS forced,
              MAX(created_at) AS lastAt
       FROM rounds`,
    )
    .get() as {
    rounds: number
    bet: number
    win: number
    winRounds: number
    forced: number
    lastAt: number | null
  }
  const sessions = db
    .prepare('SELECT COUNT(*) AS c FROM sessions')
    .get() as { c: number }

  return {
    now: new Date().toISOString(),
    uptimeSec: Math.round((Date.now() - counters.startedAt) / 1000),
    configHash: CURRENT_CONFIG_HASH,
    process: {
      spins: counters.spins,
      winRounds: counters.winRounds,
      linkTriggers: counters.linkTriggers,
      fsTriggers: counters.fsTriggers,
      betTotal: counters.betTotal,
      winTotal: counters.winTotal,
      rtp: counters.betTotal > 0 ? counters.winTotal / counters.betTotal : null,
      lastSpinAt: iso(counters.lastSpinAt),
      rejections: { ...counters.rejections },
    },
    allTime: {
      sessions: sessions.c,
      rounds: money.rounds,
      forcedRounds: money.forced,
      winRounds: money.winRounds,
      betTotal: money.bet,
      winTotal: money.win,
      rtp: money.bet > 0 ? money.win / money.bet : null,
      lastRoundAt: iso(money.lastAt),
    },
  }
}

/// Test/DI: süreç sayaçlarını sıfırla
export function resetTelemetry(): void {
  counters.startedAt = Date.now()
  counters.spins = 0
  counters.winRounds = 0
  counters.linkTriggers = 0
  counters.fsTriggers = 0
  counters.betTotal = 0
  counters.winTotal = 0
  counters.lastSpinAt = null
  counters.rejections = {}
}
