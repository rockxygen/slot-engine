import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createRng, playRound } from '@/lib/engine'
import { CLOVER_LINK_BELLS } from '@/lib/engine/config'
import type { GameConfig } from '@/lib/engine/types'
import { auditFailed, runAudit } from './audit'
import {
  clearConfigSnapshotCache,
  configHashOf,
  configVersionsDir,
  CURRENT_CONFIG_HASH,
  ensureConfigSnapshot,
  loadConfigSnapshot,
  resolveReplayConfig,
} from './config-versions'
import { openDb } from './db'
import {
  faz9RoundHash,
  legacyRoundHash,
  listRounds,
  performSpin,
  roundHash,
  verifyRound,
} from './spin-service'
import { createSession, getBalance } from './wallet'

/// İzole snapshot dizini (configVersionsDir() çağrı anında okur)
process.env.SLOT_CONFIG_VERSIONS_DIR = mkdtempSync(
  join(tmpdir(), 'slot-cfgver-'),
)

const SESSION = 'cfgver-sess-1'

/// "Eski sürüm" config: paytable'da iki hücre fark — hash'i başka,
/// replay çıktısı başkadır (gerçek sürüm değişimi simülasyonu).
function legacyConfig(): GameConfig {
  const clone = JSON.parse(JSON.stringify(CLOVER_LINK_BELLS)) as {
    paytable: Record<string, Record<number, number>>
  } & Record<string, unknown>
  clone.paytable.cherry[3] = clone.paytable.cherry[3] + 1
  clone.paytable.cherry[5] = clone.paytable.cherry[5] + 1
  return clone as unknown as GameConfig
}

function writeSnapshot(config: GameConfig): string {
  const hash = configHashOf(config)
  writeFileSync(
    join(configVersionsDir(), `${hash}.json`),
    `${JSON.stringify(config, null, 2)}\n`,
  )
  clearConfigSnapshotCache()
  return hash
}

describe('config versiyonlama (Faz 6)', () => {
  it('ensure: mevcut config snapshot\'ı yazılır ve bütünlüğü doğrulanır', () => {
    const hash = ensureConfigSnapshot()
    expect(hash).toBe(CURRENT_CONFIG_HASH)
    expect(
      existsSync(join(configVersionsDir(), `${CURRENT_CONFIG_HASH}.json`)),
    ).toBe(true)

    clearConfigSnapshotCache()
    const loaded = loadConfigSnapshot(CURRENT_CONFIG_HASH)
    expect(loaded).not.toBeNull()
    expect(configHashOf(loaded as GameConfig)).toBe(CURRENT_CONFIG_HASH)
    expect(resolveReplayConfig(CURRENT_CONFIG_HASH)?.source).toBe('current')
  })

  it('performSpin ilk turda snapshot\'ı otomatik materyalize eder', () => {
    const file = join(configVersionsDir(), `${CURRENT_CONFIG_HASH}.json`)
    rmSync(file, { force: true }) // sil → ilk spin geri yazmalı

    const db = openDb(':memory:')
    createSession(db, SESSION)
    const out = performSpin(db, {
      sessionId: SESSION,
      bet: 100,
      clientRequestId: 'cfgver-req-0001',
    })
    expect(out.ok).toBe(true)
    expect(existsSync(file)).toBe(true)
  })

  it('eski config ile oynanmış tur, snapshot ile replay edilir (R1+R2 geçer)', () => {
    const legacy = legacyConfig()
    const legacyHash = writeSnapshot(legacy)

    // Tur GERÇEKTEN eski config ile üretilmiş gibi kaydedilir
    const db = openDb(':memory:')
    createSession(db, SESSION)
    const seed = 'legacy-round-seed-01'
    const bet = 200
    const round = playRound(legacy, createRng(seed), bet)
    db.prepare(
      `INSERT INTO rounds
         (session_id, client_request_id, seed, bet, win, balance_after,
          round_hash, config_hash, forced, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
    ).run(
      SESSION,
      'legacy-req-000001',
      seed,
      bet,
      round.totalWin,
      getBalance(db, SESSION),
      roundHash(round),
      legacyHash,
      Date.now(),
    )

    const findings = runAudit(db)
    expect(auditFailed(findings)).toBe(false)
    expect(
      findings.some((f) => f.check === 'R2' && f.ok && f.detail.includes('snapshot')),
    ).toBe(true)
    expect(findings.some((f) => f.check === 'R1' && f.ok)).toBe(true)
  })

  it('config_hash "yalan" söylüyorsa (round aslında farklı config ile üretilmiş) → R1 yakalar', () => {
    const legacy = legacyConfig()
    const legacyHash = writeSnapshot(legacy) // dosya bütünlüğü SAĞLIKLI

    const db = openDb(':memory:')
    createSession(db, SESSION)
    const bet = 200
    // Öyle bir seed bul ki GÜNCEL ve ESKİ config replay'leri FARKLI
    // olsun (paytable farkının gerçekten turu etkilediği kanıtlanmış
    // örnek) — sonra round_hash güncel, sütun eski config'i göstersin.
    let seed: string | null = null
    for (let i = 0; i < 5000 && !seed; i++) {
      const s = `lying-config-seed-${i}`
      const cur = roundHash(playRound(CLOVER_LINK_BELLS, createRng(s), bet))
      const old = roundHash(playRound(legacy, createRng(s), bet))
      if (cur !== old) seed = s
    }
    expect(seed).not.toBeNull()

    const round = playRound(CLOVER_LINK_BELLS, createRng(seed as string), bet)
    db.prepare(
      `INSERT INTO rounds
         (session_id, client_request_id, seed, bet, win, balance_after,
          round_hash, config_hash, forced, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
    ).run(
      SESSION,
      'lying-req-000001',
      seed as string,
      bet,
      round.totalWin,
      getBalance(db, SESSION),
      roundHash(round),
      legacyHash,
      Date.now(),
    )

    const findings = runAudit(db)
    expect(findings.some((f) => f.check === 'R1' && !f.ok)).toBe(true)
    expect(auditFailed(findings)).toBe(true)
  })

  it('snapshot dosyası bozuksa (içerik ≠ dosya adı hash\'i) → yüklenmez, R2 yakalar', () => {
    const legacy = legacyConfig()
    const legacyHash = configHashOf(legacy)
    const file = join(configVersionsDir(), `${legacyHash}.json`)
    // Doğru ad, SAĞLIKSIZ içerik (içerik hash'i ≠ ad)
    writeFileSync(file, `${JSON.stringify({ ...legacy, bozuk: true }, null, 2)}\n`)
    clearConfigSnapshotCache()

    expect(loadConfigSnapshot(legacyHash)).toBeNull()
    expect(resolveReplayConfig(legacyHash)).toBeNull()

    const db = openDb(':memory:')
    createSession(db, SESSION)
    db.prepare(
      `INSERT INTO rounds
         (session_id, client_request_id, seed, bet, win, balance_after,
          round_hash, config_hash, forced, created_at)
       VALUES (?, ?, ?, 100, 0, ?, 'x', ?, NULL, ?)`,
    ).run(
      SESSION,
      'bozuk-req-000001',
      'corrupt-seed-01',
      getBalance(db, SESSION),
      legacyHash,
      Date.now(),
    )

    const findings = runAudit(db)
    expect(findings.some((f) => f.check === 'R2' && !f.ok)).toBe(true)
  })

  it('hiç snapshot yoksa → R2 "config sürümü kayıp"', () => {
    const missingHash = createHash('sha256').update('asla-var-olmayan').digest('hex')
    clearConfigSnapshotCache()
    expect(resolveReplayConfig(missingHash)).toBeNull()

    const db = openDb(':memory:')
    createSession(db, SESSION)
    db.prepare(
      `INSERT INTO rounds
         (session_id, client_request_id, seed, bet, win, balance_after,
          round_hash, config_hash, forced, created_at)
       VALUES (?, ?, ?, 100, 0, ?, 'x', ?, NULL, ?)`,
    ).run(
      SESSION,
      'yok-req-000001',
      'missing-seed-01',
      getBalance(db, SESSION),
      missingHash,
      Date.now(),
    )

    const findings = runAudit(db)
    const r2 = findings.find((f) => f.check === 'R2' && !f.ok)
    expect(r2?.detail).toContain('kayıp')
  })

  /// Faz 9, SpinRound'a `jackpot` alanı ekledi ve tur RNG akışına 1 adım
  /// kattı. Eski (Faz 9 öncesi) kayıtlar: config'te jackpot ANAHTARI YOK,
  /// round_hash ESKİ JSON şekliyle hesaplanmış. Bu turlar yeni koddan da
  /// birebir doğrulanabilmeli — aksi halde denetim geçmişi silinirdi.
  it('Faz 9 öncesi tur (jackpot yok + eski JSON şekli) → R1+R2+verifyRound geçer', () => {
    const preFaz9 = JSON.parse(JSON.stringify(CLOVER_LINK_BELLS)) as Record<
      string,
      unknown
    >
    delete preFaz9.jackpot
    const cfg = preFaz9 as unknown as GameConfig
    const oldCfgHash = writeSnapshot(cfg)

    const db = openDb(':memory:')
    createSession(db, SESSION)
    const seed = 'pre-faz9-seed-01'
    const bet = 200
    const round = playRound(cfg, createRng(seed), bet)
    expect(round.jackpot).toBeNull() // eski config'te jackpot yok

    db.prepare(
      `INSERT INTO rounds
         (session_id, client_request_id, seed, bet, win, balance_after,
          round_hash, config_hash, forced, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
    ).run(
      SESSION,
      'pre-faz9-req-000001',
      seed,
      bet,
      round.totalWin,
      getBalance(db, SESSION),
      legacyRoundHash(round), // ESKİ şekle göre hash'lendi
      oldCfgHash,
      Date.now(),
    )

    // R1+R2: snapshot ile replay + legacy şekil eşleşmesi
    const findings = runAudit(db)
    expect(auditFailed(findings)).toBe(false)
    expect(findings.some((f) => f.check === 'R1' && f.ok)).toBe(true)

    // verifyRound (tekil tur doğrulaması) aynı sonucu verir
    const row = listRounds(db, SESSION)[0]
    expect(verifyRound(db, row.id).ok).toBe(true)

    // İdempotent retry: eski tur OYNANDIĞI config ile replay edilir →
    // yanıt ledgertaki turun kendisi olur ve İKİNCİ KEZ para alınmaz
    const balBefore = getBalance(db, SESSION)
    const retry = performSpin(db, {
      sessionId: SESSION,
      bet,
      clientRequestId: 'pre-faz9-req-000001',
    })
    expect(retry.ok).toBe(true)
    if (retry.ok) expect(retry.round.totalWin).toBe(round.totalWin)
    expect(getBalance(db, SESSION)).toBe(balBefore)
  })

  /// Faz 9 ÖNCESİ config'te kademe tablosu `link.jackpots` ALTINDAYDI
  /// (top-level `jackpot` anahtarı henüz yoktu). Eski kod link bonusunu
  /// bu tabloyla oynardı → bugünün kodu da oynayabilmeli. (Faz 10
  /// bulgusu: `config.jackpot.tiers` koşulsuz okununca gerçek DB'deki
  /// eski link turları replay'de ÇÖKÜYORDU — bu test regresyonudur.)
  it('Faz 9 öncesi + link bonusu → eski link.jackpots tablosuyla replay (R1+R2)', () => {
    const raw = JSON.parse(JSON.stringify(CLOVER_LINK_BELLS)) as Record<string, unknown>
    delete raw.jackpot
    delete raw.bell
    // Eski kademe tablosu GERÇEK snapshot'tan kopyalandı:
    // mini/minor/major/grand — `maxi` YOK (Faz 9'da eklendi)
    const linkCfg = raw.link as Record<string, unknown>
    linkCfg.jackpotChance = 1 // her hücre kademe → eski tablo kesin kullanılır
    linkCfg.jackpots = {
      mini: { weight: 45, multiplier: 10 },
      minor: { weight: 35, multiplier: 20 },
      major: { weight: 16, multiplier: 100 },
      grand: { weight: 4, multiplier: 500 },
    }
    // Şerit: garanti 6+ link → bonus her turda tetiklenir
    raw.strips = Array.from({ length: 5 }, () =>
      Array.from({ length: 32 }, () => 'link'),
    )
    const cfg = raw as unknown as GameConfig
    const oldCfgHash = writeSnapshot(cfg)

    const db = openDb(':memory:')
    createSession(db, SESSION)
    const seed = 'pre-faz9-link-seed-01'
    const bet = 200
    const round = playRound(cfg, createRng(seed), bet)

    // Bonus eski tabloyla ÖDENDİ (crash regresyonu + kademe doğruluğu)
    expect(round.link).not.toBeNull()
    expect(round.link!.triggerCount).toBe(15) // 15 link = tam doluluk
    const legacyMultipliers: Record<string, number> = {
      mini: 10,
      minor: 20,
      major: 100,
      grand: 500,
    }
    for (const cell of round.link!.cells) {
      expect(cell.tier).not.toBeNull()
      expect(legacyMultipliers).not.toHaveProperty('maxi') // eski tabloda yok
      expect(cell.value).toBe(legacyMultipliers[cell.tier as string])
    }

    db.prepare(
      `INSERT INTO rounds
         (session_id, client_request_id, seed, bet, win, balance_after,
          round_hash, config_hash, forced, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
    ).run(
      SESSION,
      'pre-faz9-link-req-01',
      seed,
      bet,
      round.totalWin,
      getBalance(db, SESSION),
      legacyRoundHash(round),
      oldCfgHash,
      Date.now(),
    )

    const findings = runAudit(db)
    expect(auditFailed(findings)).toBe(false)
    expect(findings.some((f) => f.check === 'R1' && f.ok)).toBe(true)
    const row = listRounds(db, SESSION)[0]
    expect(verifyRound(db, row.id).ok).toBe(true)
  })

  /// Faz 10, SpinRound'a `bell` alanı ekledi. Faz 9 döneminde oynanmış
  /// kayıtlar: config'te `bell` ANAHTARI YOK, round_hash FAZ 9 JSON
  /// şekliyle (jackpot var, bell yok) hesaplanmış. Bu turlar yeni koddan
  /// da birebir doğrulanabilmeli — aksi halde denetim geçmişi silinirdi.
  it('Faz 9 turu (bell yok + faz9 JSON şekli) → R1+R2+verifyRound geçer', () => {
    const faz9 = JSON.parse(JSON.stringify(CLOVER_LINK_BELLS)) as Record<string, unknown>
    delete faz9.bell
    const cfg = faz9 as unknown as GameConfig
    const oldCfgHash = writeSnapshot(cfg)

    const db = openDb(':memory:')
    createSession(db, SESSION)
    const seed = 'faz9-round-seed-01'
    const bet = 200
    const round = playRound(cfg, createRng(seed), bet)
    expect(round.bell).toBeNull() // eski config'te çan bonusu yok

    db.prepare(
      `INSERT INTO rounds
         (session_id, client_request_id, seed, bet, win, balance_after,
          round_hash, config_hash, forced, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
    ).run(
      SESSION,
      'faz9-req-0000001',
      seed,
      bet,
      round.totalWin,
      getBalance(db, SESSION),
      faz9RoundHash(round), // FAZ 9 şekliyle hash'lendi (bell anahtarı yok)
      oldCfgHash,
      Date.now(),
    )

    // R1+R2: snapshot ile replay + faz9 şekil eşleşmesi
    const findings = runAudit(db)
    expect(auditFailed(findings)).toBe(false)
    expect(findings.some((f) => f.check === 'R1' && f.ok)).toBe(true)

    // verifyRound (tekil tur doğrulaması) aynı sonucu verir
    const row = listRounds(db, SESSION)[0]
    expect(verifyRound(db, row.id).ok).toBe(true)

    // İdempotent retry: tur OYNANDIĞI config ile replay edilir
    const balBefore = getBalance(db, SESSION)
    const retry = performSpin(db, {
      sessionId: SESSION,
      bet,
      clientRequestId: 'faz9-req-0000001',
    })
    expect(retry.ok).toBe(true)
    if (retry.ok) expect(retry.round.totalWin).toBe(round.totalWin)
    expect(getBalance(db, SESSION)).toBe(balBefore)
  })
})
