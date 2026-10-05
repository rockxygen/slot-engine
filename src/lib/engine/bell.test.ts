import { describe, expect, it } from 'vitest'
import { playBellBonus } from './bonus'
import { CLOVER_LINK_BELLS } from './config'
import { createRng } from './rng'
import { playRound } from './round'
import type { GameConfig, SymbolId } from './types'

/// Faz 10 — ÇAN RESPİN BONUSU (5+ çan → 3 hak, 15 dolum → ×3).
///
/// Sözleşmeler:
///  • tetik = gridde 5+ çan (link bonusundan AYRI ve BAĞIMSIZ bir özelliktir)
///  • haklar yeni çanda 3'e sıfırlanır, 3 boş adımda tur kapanır
///  • çan değeri bet ORANLIDIR (bet çarpanı); jackpot kadeli çanlar
///    bet × kategori çarpanı öder (kademe tablosu: jackpot.tiers)
///  • 15 çan toplanırsa toplam ödül fullMultiplier (×3) katıdır
///  • RNG akışı sabit sıra: base → jackpot → link → çan → FS;
///    eski config'te (`bell` yok) TEK ADIM bile harcanmaz

/// Şeridi test sembolleriyle dolduran test config'i
function stripConfig(fill: SymbolId[], extra: Partial<GameConfig> = {}): GameConfig {
  const strip = [...fill]
  while (strip.length < CLOVER_LINK_BELLS.rows) strip.push(...fill)
  return {
    ...CLOVER_LINK_BELLS,
    strips: Array.from({ length: 5 }, () => [...strip]),
    ...extra,
  }
}

const ALL_BELLS: GameConfig = stripConfig(['bell'])
const triggerN = (n: number): { reel: number; row: number }[] =>
  Array.from({ length: n }, (_, i) => ({ reel: i % 5, row: Math.floor(i / 5) }))

describe('playBellBonus (çan respin çekirdeği)', () => {
  it('5\'ten az çanla tetiklemek hata fırlatır (eşik = 5)', () => {
    const rng = createRng('bell-under')
    expect(() => playBellBonus(ALL_BELLS, rng, 100, triggerN(4))).toThrow()
    expect(() => playBellBonus(ALL_BELLS, rng, 100, triggerN(5))).not.toThrow()
  })

  it('adımlar monoton dolar, haklar 3\'ten başlar, dolu adımda sıfırlanır', () => {
    const cfg = stripConfig(['bell', 'bell', 'cherry', 'lemon', 'orange'])
    const bonus = playBellBonus(cfg, createRng('bell-run'), 100, triggerN(5))

    expect(bonus.triggerCount).toBe(5)
    expect(bonus.steps[0].respinsLeft).toBe(3)
    expect(bonus.steps[0].added).toHaveLength(5)

    let count = bonus.steps[0].added.length
    for (const step of bonus.steps.slice(1)) {
      expect(step.respinsLeft).toBeGreaterThanOrEqual(0)
      expect(step.respinsLeft).toBeLessThanOrEqual(3)
      count += step.added.length
      if (step.added.length > 0) expect(step.respinsLeft).toBe(3) // yeni çan → reset
      else expect(step.respinsLeft).toBeLessThan(3) // boş adım → hak azalır
    }
    expect(count).toBe(bonus.cells.length)
    expect(bonus.cells.length).toBeLessThanOrEqual(15)
  })

  it('3 boş adımda tur kapanır: sadece toplanan çanlar ödenir', () => {
    const noFill: GameConfig = stripConfig(['bell'], {
      bell: { ...CLOVER_LINK_BELLS.bell, stepCounts: { 0: 1 } },
    })
    const bonus = playBellBonus(noFill, createRng('bell-end'), 100, triggerN(5))
    // başlangıç (5 çan) + 3 boş adım
    expect(bonus.steps).toHaveLength(4)
    expect(bonus.steps.at(-1)!.respinsLeft).toBe(0)
    expect(bonus.cells).toHaveLength(5)
    expect(bonus.full).toBe(false)

    // Ödenen: toplanan çanların bet oranlı toplamı (tam doluluk YOK → ×3 yok)
    const bet = 100
    const sum = bonus.cells.reduce((s, c) => s + Math.round(c.value * bet), 0)
    expect(bonus.totalWin).toBe(sum)
  })

  it('15 çan toplanırsa (full) ödül 3 KATI ödenir', () => {
    const bonus = playBellBonus(ALL_BELLS, createRng('bell-full'), 100, triggerN(15))
    expect(bonus.full).toBe(true)
    expect(bonus.cells).toHaveLength(15)
    expect(bonus.steps).toHaveLength(1) // zaten dolu → ek adım yok

    const bet = 100
    const sum = bonus.cells.reduce((s, c) => s + Math.round(c.value * bet), 0)
    expect(bonus.totalWin).toBe(sum * CLOVER_LINK_BELLS.bell.fullMultiplier)
    expect(CLOVER_LINK_BELLS.bell.fullMultiplier).toBe(3)
    expect(bonus.totalWin).toBeGreaterThan(sum) // ×3 gerçekten uygulanmış
  })

  it('jackpotChance=1 → tüm çanlar kademeli; değer = bet × kategori çarpanı', () => {
    const allJackpot: GameConfig = stripConfig(['bell'], {
      bell: { ...CLOVER_LINK_BELLS.bell, jackpotChance: 1 },
    })
    const bonus = playBellBonus(allJackpot, createRng('bell-jp'), 100, triggerN(5))
    for (const cell of bonus.cells) expect(cell.tier).not.toBeNull()
    expect(bonus.jackpots).toHaveLength(bonus.cells.length)
    for (const cell of bonus.cells) {
      expect(cell.value).toBe(allJackpot.jackpot.tiers[cell.tier!].multiplier)
    }
    // Kademe tablosu ortak kaynak (jackpot.tiers) — erişilebilirlik
    expect(new Set(bonus.cells.map((c) => c.tier)).size).toBeGreaterThan(1)
    expect(Object.keys(allJackpot.jackpot.tiers)).toContain('grand')
  })

  it('çanlara bet oranlı para: win(k·bet) = k·win(bet) — hatasız ölçek', () => {
    const cfg = stripConfig(['bell', 'bell', 'cherry', 'lemon', 'orange'])
    const a = playBellBonus(cfg, createRng('bell-scale'), 100, triggerN(5))
    const b = playBellBonus(cfg, createRng('bell-scale'), 400, triggerN(5))
    // Aynı rng gidişatı → aynı çan değerleri; yalnızca bet ölçeklenir
    expect(b.cells.map((c) => c.value)).toEqual(a.cells.map((c) => c.value))
    expect(b.totalWin).toBe(a.totalWin * 4)
    expect(Number.isInteger(b.totalWin)).toBe(true)
  })

  it('deterministiktir: aynı rng gidişatı aynı bonusu verir', () => {
    const cfg = stripConfig(['bell', 'bell', 'cherry', 'lemon', 'orange'])
    const a = playBellBonus(cfg, createRng('bell-det'), 200, triggerN(6))
    const b = playBellBonus(cfg, createRng('bell-det'), 200, triggerN(6))
    expect(a).toEqual(b)
  })
})

describe('playRound — çan bonusu orkestrasyonu', () => {
  it('grid\'de 5+ çan varsa round.bell üretilir (burada: 15 çan → full)', () => {
    const round = playRound(ALL_BELLS, createRng('bell-forced'), 200)
    expect(round.bell).not.toBeNull()
    expect(round.bell!.triggerCount).toBe(15)
    expect(round.bell!.full).toBe(true)
    expect(round.bell!.totalWin).toBeGreaterThan(0)
    // Çanlı turda başka bonus yok (şeritte link/scatter yok)
    expect(round.link).toBeNull()
    expect(round.freeSpins).toBeNull()
  })

  it('çan yoksa round.bell null (0 çanlı şerit)', () => {
    const quiet = stripConfig(['cherry', 'lemon', 'orange', 'grapes', 'watermelon'])
    for (let i = 0; i < 50; i++) {
      expect(playRound(quiet, createRng(`bq${i}`), 100).bell).toBeNull()
    }
  })

  it('kompozisyona dahil: totalWin = base + jackpot + link + bell + fs', () => {
    for (let i = 0; i < 30; i++) {
      const round = playRound(ALL_BELLS, createRng(`bc${i}`), 200)
      const sum =
        round.base.totalWin +
        (round.jackpot?.win ?? 0) +
        (round.link?.totalWin ?? 0) +
        round.bell!.totalWin +
        (round.freeSpins?.totalWin ?? 0)
      expect(round.totalWin).toBe(sum)
    }
  })

  it('aynı seed → birebir aynı tur (replay sözleşmesi)', () => {
    const a = playRound(ALL_BELLS, createRng('bell-replay'), 200)
    const b = playRound(ALL_BELLS, createRng('bell-replay'), 200)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('eski config (bell anahtari YOK) → RNG ADIMI HARCANMAZ (eski akış birebir)', () => {
    // Faz 9 snapshot replay'i: eski kod çan bonusunu hiç çizmemişti →
    // yeni koddan akış birebir aynı kalmalı (denetim sözleşmesi).
    // Kanıt: "config'te alan yok" ile "alan var ama asla tetiklenmez"
    // üretilen turu BİREBİR aynı — yani yok sayma sıfır RNG adımı demek.
    const preFaz10 = JSON.parse(JSON.stringify(CLOVER_LINK_BELLS)) as Record<
      string,
      unknown
    >
    delete preFaz10.bell
    const oldCfg = preFaz10 as unknown as GameConfig
    const neverCfg: GameConfig = {
      ...CLOVER_LINK_BELLS,
      bell: { ...CLOVER_LINK_BELLS.bell, triggerCount: 999 }, // asla tetiklenmez
    }

    const a = playRound(oldCfg, createRng('legacy-bell-stream'), 200)
    const b = playRound(neverCfg, createRng('legacy-bell-stream'), 200)
    expect(a.bell).toBeNull()
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))

    // Replay determinizmi (eski config ile tekrar)
    const again = playRound(oldCfg, createRng('legacy-bell-stream'), 200)
    expect(JSON.stringify(again)).toBe(JSON.stringify(a))
  })
})
