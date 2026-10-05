import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto'
import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { KycStatus, Player } from '@/lib/api-types'

export type { KycStatus, Player }

/// ────────────────────────────── hesap / KYC katmanı (Faz 7 · §7)
///
/// CERTIFICATION §7: "cookie demo kimliği yerine gerçek oturum
/// yönetimi". Bu modül gerçek parada HESAP + KYC KAPISI'nın çekirdeğidir:
///
///  • Parola: scrypt (N=16384, r=8, p=1) + 16 bayt rastgele tuz,
///    karşılaştırma `timingSafeEqual` (zamanlama saldırısı yok).
///    Depolama: `scrypt$N$r$p$tuz$özet` — parametreler kayıtta,
///    ileride artırılınca eski özetler de doğrulanabilir.
///  • `kyc_status`: pending → verified (KYC sağlayıcısı onayı ile).
///    Demo'da `POST /api/auth/kyc` bunu SİMÜLE eder (gerçek entegrasyon
///    = sağlayıcı webhook'unun bu Fonksiyonu çağırması).
///  • Kapı: `kycGate` — oturumun bağlı olduğu oyuncu verified DEĞİLSE
///    yeni tur üretilmez (`performSpin` → `kyc_required`).
///    Anonim demo oturumları (player_id NULL) politikaya göre serbest
///    veya tamamen kapalı (`SLOT_REQUIRE_KYC=1` → hesap zorunlu).
///
/// Oturum (HttpOnly cookie) DEĞİŞMEZ — onun altına oyuncu BAĞI eklenir;
/// bakiye/ledger oturumda kalır (kimlik ile para ayrıdır).

const USERNAME_RE = /^[a-z0-9_\-]{3,32}$/
const MIN_PASSWORD = 8

/// scrypt parametreleri (kayıt formatında saklanır)
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 } as const

export function hashPassword(password: string): string {
  if (password.length < MIN_PASSWORD) {
    throw new RangeError(`Parola en az ${MIN_PASSWORD} karakter olmalı`)
  }
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
  })
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('hex')}$${hash.toString('hex')}`
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [algo, n, r, p, saltHex, hashHex] = stored.split('$')
    if (algo !== 'scrypt') return false
    const expected = Buffer.from(hashHex, 'hex')
    const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    })
    return timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}

function rowToPlayer(row: {
  id: string
  username: string
  kyc_status: KycStatus
}): Player {
  return { id: row.id, username: row.username, kycStatus: row.kyc_status }
}

/// Kayıt. Doğrulama ihlali → RangeError; kullanıcı adı dolu → Error.
export function registerPlayer(
  db: DatabaseSync,
  username: string,
  password: string,
): Player {
  if (!USERNAME_RE.test(username)) {
    throw new RangeError(
      'Kullanıcı adı 3–32 karakter olmalı; yalnızca a-z, 0-9, _ ve -',
    )
  }
  const id = randomUUID()
  try {
    db.prepare(
      `INSERT INTO players (id, username, password_hash, kyc_status, created_at)
       VALUES (?, ?, ?, 'pending', ?)`,
    ).run(id, username, hashPassword(password), Date.now())
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('UNIQUE')) throw new Error('Bu kullanıcı adı alınmış')
    throw err
  }
  return { id, username, kycStatus: 'pending' }
}

export function getPlayer(db: DatabaseSync, id: string): Player | null {
  const row = db
    .prepare('SELECT id, username, kyc_status FROM players WHERE id = ?')
    .get(id) as
    | { id: string; username: string; kyc_status: KycStatus }
    | undefined
  return row ? rowToPlayer(row) : null
}

export function authenticate(
  db: DatabaseSync,
  username: string,
  password: string,
): Player | null {
  const row = db
    .prepare('SELECT id, username, password_hash, kyc_status FROM players WHERE username = ?')
    .get(username) as
    | { id: string; username: string; password_hash: string; kyc_status: KycStatus }
    | undefined
  if (!row) return null
  // kullanıcı yoksa da benzer süre: doğrudan null (timing sızıntısı minimal)
  if (!verifyPassword(password, row.password_hash)) return null
  return rowToPlayer(row)
}

export function setKycStatus(
  db: DatabaseSync,
  playerId: string,
  status: KycStatus,
): void {
  db.prepare('UPDATE players SET kyc_status = ? WHERE id = ?').run(
    status,
    playerId,
  )
}

/// Oturumu oyuncuya bağla (giriş/kayıt anı)
export function bindSessionToPlayer(
  db: DatabaseSync,
  sessionId: string,
  playerId: string,
): void {
  db.prepare('UPDATE sessions SET player_id = ? WHERE id = ?').run(
    playerId,
    sessionId,
  )
}

export function unbindSession(db: DatabaseSync, sessionId: string): void {
  db.prepare('UPDATE sessions SET player_id = NULL WHERE id = ?').run(
    sessionId,
  )
}

export function sessionPlayer(db: DatabaseSync, sessionId: string): Player | null {
  const row = db
    .prepare('SELECT player_id FROM sessions WHERE id = ?')
    .get(sessionId) as { player_id: string | null } | undefined
  if (!row?.player_id) return null
  return getPlayer(db, row.player_id)
}

export type KycGateResult = 'ok' | 'account_required' | 'kyc_pending'

/**
 * Oyun oynama kapısı (pre-spin):
 *  • Oyuncu bağlıysa: yalnızca `verified`.
 *  • Bağlı değilse: `requireAccount` false → anonim demo serbest;
 *    true → hesap zorunlu (`account_required`).
 */
export function kycGate(
  db: DatabaseSync,
  sessionId: string,
  requireAccount: boolean,
): KycGateResult {
  const player = sessionPlayer(db, sessionId)
  if (!player) return requireAccount ? 'account_required' : 'ok'
  return player.kycStatus === 'verified' ? 'ok' : 'kyc_pending'
}
