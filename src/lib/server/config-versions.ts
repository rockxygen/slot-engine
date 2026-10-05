import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CLOVER_LINK_BELLS } from '@/lib/engine/config'
import type { GameConfig } from '@/lib/engine/types'

/// ─────────────────────────────────── config sürümleme (Faz 6)
///
/// Sertifikasyon sözü: "eski turlar, oynandıkları matematikle replay
/// edilebilir". Her binary KENDİ config'inin snapshot'ını ilk turda
/// `.data/config-versions/<hash>.json` dosyasına yazar; config
/// değişince ESKİ dosya yerinde kalır → denetçi o dosyayla replay
/// eder (audit R1/R2).
///
/// hash = sha256(JSON.stringify(config)) — round.config_hash ile AYNI
/// hesap (ekleme sırası sabit → tekrarlanabilir).

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/// Bu binary'nin oyun verisi parmak izi
export const CURRENT_CONFIG_HASH = sha256(JSON.stringify(CLOVER_LINK_BELLS))

export function configHashOf(config: GameConfig): string {
  return sha256(JSON.stringify(config))
}

export function configVersionsDir(): string {
  return (
    process.env.SLOT_CONFIG_VERSIONS_DIR ??
    join(process.cwd(), '.data', 'config-versions')
  )
}

/**
 * Mevcut config'in snapshot'ını garanti eder (yoksa yazar).
 * Round yazımından ÖNCE çağrılır — böylece ilerideki her denetim,
 * bu sürümün verisine erişebilir. Yazma hatası turu düşürmez
 * (yakalanır ve loglanır); denetimde eksikliği R2 raporlar.
 */
export function ensureConfigSnapshot(): string {
  const dir = configVersionsDir()
  const file = join(dir, `${CURRENT_CONFIG_HASH}.json`)
  if (!existsSync(file)) {
    mkdirSync(dir, { recursive: true })
    writeFileSync(file, `${JSON.stringify(CLOVER_LINK_BELLS, null, 2)}\n`)
  }
  return CURRENT_CONFIG_HASH
}

const cache = new Map<string, GameConfig | null>()

/**
 * Hash'e göre tarihsel config'i yükler; bulamazsa null.
 * Dosya bütünlüğü doğrulanır: içeriğin yeniden hesaplanan hash'i
 * dosya adıyla AYNI olmalı (bozulma/sahte içerik → null).
 */
export function loadConfigSnapshot(hash: string): GameConfig | null {
  if (cache.has(hash)) return cache.get(hash) ?? null

  let result: GameConfig | null = null
  try {
    const file = join(configVersionsDir(), `${hash}.json`)
    if (existsSync(file)) {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as GameConfig
      if (configHashOf(parsed) === hash) result = parsed
    }
  } catch {
    result = null
  }
  cache.set(hash, result)
  return result
}

/// Replay için round'ın config'ini çöz: güncel binary mi, snapshot mı?
export interface ResolvedConfig {
  readonly config: GameConfig
  readonly source: 'current' | 'snapshot'
}

export function resolveReplayConfig(hash: string): ResolvedConfig | null {
  if (hash === CURRENT_CONFIG_HASH) {
    return { config: CLOVER_LINK_BELLS, source: 'current' }
  }
  const snapshot = loadConfigSnapshot(hash)
  return snapshot ? { config: snapshot, source: 'snapshot' } : null
}

/// Test/DI: snapshot önbelleğini temizle (dosya sistemini yeniden oku)
export function clearConfigSnapshotCache(): void {
  cache.clear()
}
