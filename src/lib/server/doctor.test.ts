import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { EntropySelfTest } from './entropy'
import { resetEntropyCacheForTest, setEntropyOverrideForTest } from './entropy'
import { doctorExitCode, runDoctor } from './doctor'
import { openDb } from './db'

/// Yayın ortamı kontrolü (Faz 7 · §7): fail senaryoları KODLA kanıtlanır —
/// "force production'da kapalı" iddia değil, ölçüm.

const dir = mkdtempSync(join(tmpdir(), 'slot-doctor-'))
const goodDbPath = join(dir, 'good.db')
{
  const db = openDb(goodDbPath)
  db.close()
}
const badDbPath = join(dir, 'garbage.db')
writeFileSync(badDbPath, 'bu bir sqlite dosyasi degil')

const baseEnv = (
  extra: Record<string, string | undefined> = {},
): Record<string, string | undefined> => ({
  SLOT_DB_PATH: goodDbPath,
  SLOT_CONFIG_VERSIONS_DIR: join(dir, 'snapshots'),
  ...extra,
  NODE_ENV: 'production',
})

describe('doctor — yayın ortamı kontrolü (Faz 7)', () => {
  it('production + temiz ortam → 0 hata, 0 uyarı, exit 0', () => {
    const r = runDoctor(baseEnv())
    expect(r.failed).toBe(0)
    expect(r.warned).toBe(0)
    expect(doctorExitCode(r)).toBe(0)
    expect(doctorExitCode(r, true)).toBe(0)
    const ids = r.checks.map((c) => c.id)
    expect(ids).toContain('force_gate')
    expect(ids).toContain('cookie_secure')
    expect(ids).toContain('entropy')
    expect(ids).toContain('config_hash')
  })

  it('production + SLOT_ALLOW_FORCE=1 → force_gate FAIL, exit 1', () => {
    const r = runDoctor(baseEnv({ SLOT_ALLOW_FORCE: '1' }))
    const force = r.checks.find((c) => c.id === 'force_gate')
    expect(force?.level).toBe('fail')
    expect(r.failed).toBeGreaterThan(0)
    expect(doctorExitCode(r)).toBe(1)
  })

  it('geliştirme ortamı → uyarılar var ama exit 0; strict modda 1', () => {
    const r = runDoctor({
      SLOT_DB_PATH: goodDbPath,
      SLOT_CONFIG_VERSIONS_DIR: join(dir, 'snapshots'),
    })
    expect(r.failed).toBe(0)
    expect(r.warned).toBeGreaterThan(0) // node_env + cookie_secure
    expect(doctorExitCode(r, false)).toBe(0)
    expect(doctorExitCode(r, true)).toBe(1)
  })

  it('bozuk (SQLite olmayan) DB → db_path FAIL', () => {
    const r = runDoctor(baseEnv({ SLOT_DB_PATH: badDbPath }))
    const db = r.checks.find((c) => c.id === 'db_path')
    expect(db?.level).toBe('fail')
    expect(doctorExitCode(r)).toBe(1)
  })

  it('RNG entropi sağlığı başarısız → entropy FAIL', () => {
    const failed: EntropySelfTest = {
      source: 'test',
      ok: false,
      failures: ['constant'],
      testedAt: new Date().toISOString(),
      bitsSampled: 0,
      onesRatio: 0,
    }
    resetEntropyCacheForTest()
    setEntropyOverrideForTest(failed)
    try {
      const r = runDoctor(baseEnv())
      const entropy = r.checks.find((c) => c.id === 'entropy')
      expect(entropy?.level).toBe('fail')
      expect(entropy?.detail).toContain('constant')
      expect(doctorExitCode(r)).toBe(1)
    } finally {
      setEntropyOverrideForTest(null)
      resetEntropyCacheForTest()
    }
  })
})
