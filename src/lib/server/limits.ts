import type { DatabaseSync } from 'node:sqlite'

/// ─────────────────────────────── sorumlu oyun limitleri (Faz 7 · §7)
///
/// Gerçek para şartı: kayıp limiti, harcama (ciro) limiti ve oturum
/// süresi limiti SUNUCUDA zorlanır — istemci bunu atlayamaz. Limit
/// `NULL` = sınırsız (demo varsayılanı); hesap/KYC akışında (Faz 7e)
/// kayıt anında zorunlu kılınacak.
///
/// Zorlama noktası: `performSpin` — mevcut turun idempotent replay'i
/// DEĞİL, YENİ tur kabul edilmeden önce. İhlal → tur yazılmaz, para
/// hareketi olmaz (iz yok).

export interface SessionLimits {
  /// Net kayıp (toplam bahis − toplam kazanç) bu değere ulaşırsa dur
  lossLimit: number | null
  /// Toplam ciro + bu bahis limiti aşarsa dur
  spendLimit: number | null
  /// Oturum açılışından itibaren süre (saniye) aşılırsa dur
  sessionLimitSec: number | null
}

export type LimitId = 'loss_limit' | 'spend_limit' | 'session_time'

export const LIMIT_LABELS: Record<LimitId, string> = {
  loss_limit: 'Kayıp limiti',
  spend_limit: 'Harcama (ciro) limiti',
  session_time: 'Oturum süresi limiti',
}

export interface LimitUsage {
  readonly netLoss: number
  readonly spend: number
  readonly playSeconds: number
}

const MAX_LIMIT = 1_000_000_000 // 10 milyon ₺ (minor) — garip büyük değerleri eler

function normalize(name: string, v: number | null): number | null {
  if (v === null) return null
  if (!Number.isInteger(v) || v <= 0 || v > MAX_LIMIT) {
    throw new RangeError(
      `${name}: null (sınırsız) ya da 1..${MAX_LIMIT} arası tam sayı olmalı, aldı: ${String(v)}`,
    )
  }
  return v
}

export function getLimits(db: DatabaseSync, sessionId: string): SessionLimits {
  const row = db
    .prepare(
      'SELECT loss_limit, spend_limit, session_limit_sec FROM sessions WHERE id = ?',
    )
    .get(sessionId) as
    | { loss_limit: number | null; spend_limit: number | null; session_limit_sec: number | null }
    | undefined
  if (!row) throw new Error(`session yok: ${sessionId}`)
  return {
    lossLimit: row.loss_limit,
    spendLimit: row.spend_limit,
    sessionLimitSec: row.session_limit_sec,
  }
}

/**
 * Limitleri güncelle. PATCH semantics: anahtarda VARSA güncellenir
 * (null = sınırsız bırak), YOKSA mevcut değer korunur.
 * Geçersiz değer → RangeError (route 400 döner).
 */
export function setLimits(
  db: DatabaseSync,
  sessionId: string,
  patch: Partial<SessionLimits>,
): SessionLimits {
  const cur = getLimits(db, sessionId)
  const next: SessionLimits = {
    lossLimit:
      'lossLimit' in patch
        ? normalize('lossLimit', patch.lossLimit ?? null)
        : cur.lossLimit,
    spendLimit:
      'spendLimit' in patch
        ? normalize('spendLimit', patch.spendLimit ?? null)
        : cur.spendLimit,
    sessionLimitSec:
      'sessionLimitSec' in patch
        ? normalize('sessionLimitSec', patch.sessionLimitSec ?? null)
        : cur.sessionLimitSec,
  }
  db.prepare(
    'UPDATE sessions SET loss_limit = ?, spend_limit = ?, session_limit_sec = ? WHERE id = ?',
  ).run(
    next.lossLimit,
    next.spendLimit,
    next.sessionLimitSec,
    sessionId,
  )
  return next
}

/// Oturumun bugüne kadarko kullanımı (round tablosundan türetilir —
/// denetim kaydıyla aynı kaynak, sayaç ayrıca tutulmaz).
export function limitUsage(
  db: DatabaseSync,
  sessionId: string,
  now = Date.now(),
): LimitUsage {
  const m = db
    .prepare(
      'SELECT COALESCE(SUM(bet), 0) AS b, COALESCE(SUM(win), 0) AS w FROM rounds WHERE session_id = ?',
    )
    .get(sessionId) as { b: number; w: number }
  const s = db
    .prepare('SELECT created_at FROM sessions WHERE id = ?')
    .get(sessionId) as { created_at: number } | undefined
  if (!s) throw new Error(`session yok: ${sessionId}`)
  return {
    netLoss: m.b - m.w,
    spend: m.b,
    playSeconds: Math.max(0, Math.floor((now - s.created_at) / 1000)),
  }
}

/**
 * Girişteki bahisle limit ihlali var mı? (pre-spin kontrolü)
 * İhlal eden İLK limit döner; null = geçebilir.
 */
export function checkLimits(
  limits: SessionLimits,
  usage: LimitUsage,
  incomingBet: number,
): LimitId | null {
  if (
    limits.sessionLimitSec !== null &&
    usage.playSeconds >= limits.sessionLimitSec
  ) {
    return 'session_time'
  }
  if (limits.lossLimit !== null && usage.netLoss >= limits.lossLimit) {
    return 'loss_limit'
  }
  if (
    limits.spendLimit !== null &&
    usage.spend + incomingBet > limits.spendLimit
  ) {
    return 'spend_limit'
  }
  return null
}
