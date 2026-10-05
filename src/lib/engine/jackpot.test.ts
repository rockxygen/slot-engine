import { describe, expect, it } from 'vitest'
import { CLOVER_LINK_BELLS } from './config'
import { drawSpinJackpot, pickJackpotTier } from './jackpot'
import { createRng } from './rng'
import { playRound } from './round'
import { JACKPOT_TIERS, type GameConfig, type JackpotConfig, type JackpotTier } from './types'

/// Faz 9 — JACKPOT (5 kademe): Mini/Minor/Maxi/Major/Grand.
///
/// Sözleşmeler:
///  • ödül ORANTILIDIR: win = bet × tier.multiplier (tamsayı, lineer)
///  • kademe tablosu TEK KAYNAK: spin düşüşü ve link hücreleri `jackpot.tiers`
///  • düşüş normal spine aittir; RNG akışı sabit sıra (base → jackpot → link → FS)

const TIERS = CLOVER_LINK_BELLS.jackpot.tiers

const cfg = (spinChance: number): GameConfig => ({
  ...CLOVER_LINK_BELLS,
  jackpot: { ...CLOVER_LINK_BELLS.jackpot, spinChance },
})

describe('pickJackpotTier', () => {
  it('deterministiktir: aynı rng gidişatı aynı kademeyi verir', () => {
    const a = createRng('tier-det')
    const b = createRng('tier-det')
    for (let i = 0; i < 50; i++) {
      expect(pickJackpotTier(a, TIERS)).toBe(pickJackpotTier(b, TIERS))
    }
  })

  it('5 kademenin hepsi erişilebilir (maxi dahil)', () => {
    const rng = createRng('tier-all')
    const seen = new Set<JackpotTier>()
    for (let i = 0; i < 4000; i++) seen.add(pickJackpotTier(rng, TIERS))
    expect([...seen].sort()).toEqual([...JACKPOT_TIERS].sort())
  })

  it('ağırlık sırası korunur: mini en sık → grand en nadir', () => {
    const rng = createRng('tier-order')
    const counts: Record<JackpotTier, number> = {
      mini: 0,
      minor: 0,
      maxi: 0,
      major: 0,
      grand: 0,
    }
    for (let i = 0; i < 10_000; i++) counts[pickJackpotTier(rng, TIERS)]++
    expect(counts.mini).toBeGreaterThan(counts.minor)
    expect(counts.minor).toBeGreaterThan(counts.maxi)
    expect(counts.maxi).toBeGreaterThan(counts.major)
    expect(counts.major).toBeGreaterThan(counts.grand)
    expect(counts.grand).toBeGreaterThan(0)
  })

  it('toplam ağırlık 0 ise hata fırlatır', () => {
    const empty: JackpotConfig = {
      spinChance: 1,
      tiers: {
        mini: { weight: 0, multiplier: 10 },
        minor: { weight: 0, multiplier: 20 },
        maxi: { weight: 0, multiplier: 50 },
        major: { weight: 0, multiplier: 100 },
        grand: { weight: 0, multiplier: 500 },
      },
    }
    expect(() => pickJackpotTier(createRng('w'), empty.tiers)).toThrow()
  })
})

describe('drawSpinJackpot', () => {
  it('spinChance=0 → hiç düşmez', () => {
    const rng = createRng('no-drop')
    for (let i = 0; i < 200; i++) {
      expect(drawSpinJackpot(rng, cfg(0).jackpot, 100)).toBeNull()
    }
  })

  it('Faz 9 öncesi config (jackpot alanı YOK) → RNG adım harcanmaz', () => {
    // Eski snapshot replay'i: eski kod bu adımı hiç çizmemişti → yeni
    // koddan base→link→FS akışı birebir aynı kalmalı (denetim sözleşmesi)
    const rng = createRng('legacy-stream')
    const before = JSON.stringify(rng.state())
    expect(drawSpinJackpot(rng, undefined, 200)).toBeNull()
    expect(drawSpinJackpot(rng, null, 200)).toBeNull()
    expect(JSON.stringify(rng.state())).toBe(before)
  })

  it('spinChance=1 → her çizimde kademe, win = bet × multiplier', () => {
    const rng = createRng('all-drop')
    const bet = 200
    for (let i = 0; i < 300; i++) {
      const hit = drawSpinJackpot(rng, cfg(1).jackpot, bet)
      expect(hit).not.toBeNull()
      expect(JACKPOT_TIERS).toContain(hit!.tier)
      expect(hit!.win).toBe(bet * TIERS[hit!.tier].multiplier)
      expect(Number.isInteger(hit!.win)).toBe(true)
      expect(hit!.win).toBeGreaterThanOrEqual(bet * 10) // mini en düşük
    }
  })

  it('orantılı: aynı seed aynı kademe → win(k·bet) = k·win(bet)', () => {
    // RNG akışı bet'ten bağımsızdır (çekirdek property testini de doğrular)
    const a = drawSpinJackpot(createRng('scale'), cfg(1).jackpot, 100)
    const b = drawSpinJackpot(createRng('scale'), cfg(1).jackpot, 700)
    expect(b?.tier).toBe(a?.tier)
    expect(b?.win).toBe((a?.win ?? 0) * 7)
  })
})

describe('playRound — spin jackpot düşüşü', () => {
  it('spinChance=0 → round.jackpot her turda null', () => {
    const c = cfg(0)
    for (let i = 0; i < 100; i++) {
      expect(playRound(c, createRng(`nj${i}`), 200).jackpot).toBeNull()
    }
  })

  it('spinChance=1 → her turda jackpot ve kompozisyona dahil', () => {
    const c = cfg(1)
    for (let i = 0; i < 100; i++) {
      const round = playRound(c, createRng(`aj${i}`), 200)
      expect(round.jackpot).not.toBeNull()
      expect(round.totalWin).toBe(
        round.base.totalWin +
          round.jackpot!.win +
          (round.link?.totalWin ?? 0) +
          (round.freeSpins?.totalWin ?? 0),
      )
    }
  })

  it('aynı seed → birebir aynı jackpot (replay sözleşmesi)', () => {
    const a = playRound(cfg(0.5), createRng('jp-replay'), 200)
    const b = playRound(cfg(0.5), createRng('jp-replay'), 200)
    expect(a.jackpot).toEqual(b.jackpot)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
})
