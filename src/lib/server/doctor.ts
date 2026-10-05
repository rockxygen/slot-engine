import {
  existsSync,
  accessSync,
  constants,
  readdirSync,
  statSync,
} from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { CURRENT_CONFIG_HASH } from './config-versions'
import { entropyStatus } from './entropy'

/// ─────────────────────────────────── yayın ortamı kontrolü (Faz 7 · §7)
///
/// `npm run doctor` — deploy öncesi ayakta kontrol. Sertifika §7'deki
/// "TLS/Secure cookie tam ortam doğrulaması" ve "force kapalı" şartları
/// burada KODLA sınanır (belgede iddia değil, ölçüm).
///
/// • fail → çıkış kodu 1 (deploy durmalı)
/// • warn → bilgi (production dışı ortamda beklenen); `--strict` ile
///   deploy kapısında warn da fail sayılır

export type CheckLevel = 'ok' | 'warn' | 'fail'

export interface DoctorCheck {
  readonly id:
    | 'node_env'
    | 'force_gate'
    | 'cookie_secure'
    | 'db_path'
    | 'config_versions'
    | 'config_hash'
    | 'entropy'
  readonly level: CheckLevel
  readonly detail: string
}

export interface DoctorReport {
  readonly checks: readonly DoctorCheck[]
  readonly failed: number
  readonly warned: number
}

/// En yakın MEVCUT ust dizini yazılabilir mi? (yol henüz yok olabilir)
function nearestExistingDir(start: string): string | null {
  let dir = resolve(start)
  for (;;) {
    if (existsSync(dir)) return dir
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

function checkDbPath(path: string): DoctorCheck {
  try {
    if (existsSync(path)) {
      accessSync(path, constants.W_OK)
      // salt-okunur aç + bütünlük: quick_check (doctor YAZMAZ)
      const db = new DatabaseSync(path, { readOnly: true })
      try {
        const r = db.prepare('PRAGMA quick_check').get() as Record<
          string,
          unknown
        >
        const verdict = Object.values(r)[0]
        if (verdict !== 'ok') {
          return {
            id: 'db_path',
            level: 'fail',
            detail: `SQLite quick_check başarısız: ${String(verdict)} (${path})`,
          }
        }
      } finally {
        db.close()
      }
      return {
        id: 'db_path',
        level: 'ok',
        detail: `mevcut, yazılabilir, quick_check ok (${path})`,
      }
    }
    const dir = nearestExistingDir(dirname(resolve(path)))
    if (!dir) {
      return {
        id: 'db_path',
        level: 'fail',
        detail: `yazılabilir üst dizin bulunamadı: ${path}`,
      }
    }
    accessSync(dir, constants.W_OK)
    return {
      id: 'db_path',
      level: 'ok',
      detail: `yok — ilk açılışta oluşturulacak, üst dizin yazılabilir (${path})`,
    }
  } catch (err) {
    return {
      id: 'db_path',
      level: 'fail',
      detail: `erişilemedi: ${err instanceof Error ? err.message : err} (${path})`,
    }
  }
}

function checkWritableDir(rawPath: string): DoctorCheck | null {
  try {
    const path = isAbsolute(rawPath) ? rawPath : resolve(rawPath)
    const dir = existsSync(path) ? path : nearestExistingDir(path)
    if (!dir) {
      return {
        id: 'config_versions',
        level: 'fail',
        detail: `snapshot dizini yazılamaz: ${rawPath}`,
      }
    }
    accessSync(dir, constants.W_OK)
    const count = existsSync(path)
      ? statSync(path).isDirectory()
        ? ` — ${readdirSync(path).length} snapshot`
        : ''
      : ' (ilk kullanımda oluşacak)'
    return {
      id: 'config_versions',
      level: 'ok',
      detail: `yazılabilir${count} (${rawPath})`,
    }
  } catch (err) {
    return {
      id: 'config_versions',
      level: 'fail',
      detail: `erişilemedi: ${err instanceof Error ? err.message : err}`,
    }
  }
}

/**
 * Ortam kontrolü — saf fonksiyon (env enjekte edilebilir; testler
 * `NODE_ENV`/`SLOT_*` ile oynar). Next'in `ProcessEnv` Augment'i yerine
 * gevşek kayıt tipi: NODE_ENV bilerek opsiyoneldir (dev'de tanımsızdır).
 */
export function runDoctor(
  env: Record<string, string | undefined> = process.env,
): DoctorReport {
  const checks: DoctorCheck[] = []
  const isProd = env.NODE_ENV === 'production'

  // 1) Ortam
  checks.push(
    isProd
      ? { id: 'node_env', level: 'ok', detail: 'NODE_ENV=production' }
      : {
          id: 'node_env',
          level: 'warn',
          detail: `NODE_ENV=${env.NODE_ENV ?? '(tanımsız)'} — üretimde \`npm start\` (production) kullanın`,
        },
  )

  // 2) QA force kapısı — production'da AÇIKSA FAIL (lisanslı yayında yasak)
  if (isProd) {
    checks.push(
      env.SLOT_ALLOW_FORCE === '1'
        ? {
            id: 'force_gate',
            level: 'fail',
            detail: 'SLOT_ALLOW_FORCE=1 — QA force kapısı PRODUCTION\'DA AÇIK',
          }
        : {
            id: 'force_gate',
            level: 'ok',
            detail: 'force kapısı kapalı (?force= üretime kapalı)',
          },
    )
  } else {
    checks.push({
      id: 'force_gate',
      level: 'ok',
      detail: `geliştirme ortamı — force ${env.SLOT_ALLOW_FORCE === '1' ? 'açık (QA)' : 'kapalı'}`,
    })
  }

  // 3) Cookie güvenliği — Secure, production'da NODE_ENV'den doğar
  //    (session.ts: secure: NODE_ENV === 'production')
  checks.push(
    isProd
      ? {
          id: 'cookie_secure',
          level: 'ok',
          detail: 'slot_sid: HttpOnly + SameSite=Lax + Secure (production)',
        }
      : {
          id: 'cookie_secure',
          level: 'warn',
          detail:
            'Secure bayrağı yalnızca production\'da devreye girer (TLS arkasında doğrula)',
        },
  )

  // 4) Denetim veritabanı
  const dbPath = env.SLOT_DB_PATH ?? join(process.cwd(), '.data', 'slot.db')
  checks.push(checkDbPath(dbPath))

  // 5) Config versiyon snapshot dizini (yedeklemeyle birlikte korunur)
  const snapDir =
    env.SLOT_CONFIG_VERSIONS_DIR ??
    join(process.cwd(), '.data', 'config-versions')
  const snap = checkWritableDir(snapDir)
  if (snap) checks.push(snap)

  // 6) RNG entropi sağlığı — başarısızsa oyun zaten oynamaz
  try {
    const t = entropyStatus()
    checks.push(
      t.ok
        ? {
            id: 'entropy',
            level: 'ok',
            detail: `sağlık testi geçti (${t.bitsSampled} bit, oran %${(t.onesRatio * 100).toFixed(1)}) — ${t.source}`,
          }
        : {
            id: 'entropy',
            level: 'fail',
            detail: `RNG sağlık testi BAŞARISIZ: ${t.failures.join(', ')} — oyun oynatmıyor`,
          },
    )
  } catch (err) {
    checks.push({
      id: 'entropy',
      level: 'fail',
      detail: `entropi kaynağı yok: ${err instanceof Error ? err.message : err}`,
    })
  }

  // (bilgi) canlı config parmak izi — deploy kaydıyla karşılaştırılır
  checks.push({
    id: 'config_hash',
    level: 'ok',
    detail: `config hash ${CURRENT_CONFIG_HASH.slice(0, 16)}…`,
  })

  return {
    checks,
    failed: checks.filter((c) => c.level === 'fail').length,
    warned: checks.filter((c) => c.level === 'warn').length,
  }
}

/// Çıkış kodu: fail → 1; strict'te warn da 1
export function doctorExitCode(r: DoctorReport, strict = false): number {
  if (r.failed > 0) return 1
  if (strict && r.warned > 0) return 1
  return 0
}
