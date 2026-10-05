import { describe, expect, it } from 'vitest'
import { CLOVER_LINK_BELLS } from './config'
import { createRng } from './rng'
import { playFreeSpins, playLinkBonus } from './bonus'
import { playRound } from './round'
import { JACKPOT_TIERS, type GameConfig, type SymbolId } from './types'

/// Şeridi test sembolleriyle dolduran test config'i
/// (şerit en az `rows` uzunluğunda olmalı → yinelenecek)
function stripConfig(fill: SymbolId[], extra: Partial<GameConfig> = {}): GameConfig {
  const strip = [...fill]
  while (strip.length < CLOVER_LINK_BELLS.rows) strip.push(...fill)
  return {
    ...CLOVER_LINK_BELLS,
    strips: Array.from({ length: 5 }, () => [...strip]),
    ...extra,
  }
}

describe('playLinkBonus (respins)', () => {
  /// Zorunlu tetik: şeritlerin her makarasında 2 link → gridde 10 link
  const linkCfg = stripConfig(['link', 'link', 'cherry', 'lemon', 'orange'])

  it('tetiklenmeden çağırmak hata fırlatır', () => {
    const rng = createRng('t')
    expect(() =>
      playLinkBonus(linkCfg, rng, 100, [
        { reel: 0, row: 0 },
        { reel: 1, row: 0 },
      ]),
    ).toThrow()
  })

  it('adımlar monoton dolar, haklar 3’ten başlar ve hiç 0’ın altına inmez', () => {
    const rng = createRng('link-run')
    const trigger = [
      { reel: 0, row: 0 },
      { reel: 0, row: 1 },
      { reel: 1, row: 0 },
      { reel: 1, row: 1 },
      { reel: 2, row: 0 },
      { reel: 2, row: 1 },
    ]
    const bonus = playLinkBonus(linkCfg, rng, 100, trigger)

    expect(bonus.triggerCount).toBe(6)
    expect(bonus.steps[0].respinsLeft).toBe(3)

    let count = bonus.steps[0].added.length
    expect(count).toBe(6)
    for (const step of bonus.steps.slice(1)) {
      expect(step.respinsLeft).toBeGreaterThanOrEqual(0)
      expect(step.respinsLeft).toBeLessThanOrEqual(3)
      count += step.added.length
      // dolu adımda hak 3'e döner, boş adımda 1 azalır
      if (step.added.length > 0) expect(step.respinsLeft).toBe(3)
      else expect(step.respinsLeft).toBeLessThan(3)
    }
    expect(count).toBe(bonus.cells.length)
    expect(bonus.cells.length).toBeLessThanOrEqual(15)
  })

  it('hücreler tekrarsızdır ve 15’i geçmez', () => {
    const rng = createRng('unique')
    const trigger = Array.from({ length: 7 }, (_, i) => ({
      reel: i % 5,
      row: Math.floor(i / 5),
    }))
    const bonus = playLinkBonus(linkCfg, rng, 100, trigger)
    const keys = bonus.cells.map((c) => `${c.reel}:${c.row}`)
    expect(new Set(keys).size).toBe(keys.length)
    expect(bonus.cells.length).toBeLessThanOrEqual(15)
    expect(bonus.full).toBe(bonus.cells.length === 15)
  })

  it('toplam kazanç = Σ(sembol değeri × bet)', () => {
    const rng = createRng('sum-link')
    const trigger = Array.from({ length: 6 }, (_, i) => ({ reel: i % 5, row: 0 }))
    const bet = 100
    const bonus = playLinkBonus(linkCfg, rng, bet, trigger)
    const sum = bonus.cells.reduce((s, c) => s + Math.round(c.value * bet), 0)
    expect(bonus.totalWin).toBe(sum)
    expect(bonus.totalWin).toBeGreaterThan(0)
  })

  it('deterministiktir: aynı rng gidişatı aynı turu verir', () => {
    const trigger = Array.from({ length: 6 }, (_, i) => ({ reel: i % 5, row: 1 }))
    const a = playLinkBonus(linkCfg, createRng('det'), 100, trigger)
    const b = playLinkBonus(linkCfg, createRng('det'), 100, trigger)
    expect(a).toEqual(b)
  })

  it('jackpot kademesi düştüğünde tier atanır ve çarpanı kullanılır', () => {
    // jackpotChance=1 → her hücre jackpot olmalı
    const allJackpot: GameConfig = {
      ...linkCfg,
      link: { ...linkCfg.link, jackpotChance: 1 },
    }
    const trigger = Array.from({ length: 6 }, (_, i) => ({ reel: i % 5, row: 0 }))
    const bonus = playLinkBonus(allJackpot, createRng('jp'), 100, trigger)
    for (const cell of bonus.cells) expect(cell.tier).not.toBeNull()
    expect(bonus.jackpots.length).toBe(bonus.cells.length)
    // tier çarpanı config'den gelmeli (tek kaynak: jackpot.tiers)
    for (const cell of bonus.cells) {
      expect(cell.value).toBe(allJackpot.jackpot.tiers[cell.tier!].multiplier)
    }
    // 5 kademenin hepsi erişilebilir (mini→grand; maxi dahil)
    const seen = new Set(bonus.cells.map((c) => c.tier))
    expect(seen.size).toBeGreaterThan(1)
    for (const t of JACKPOT_TIERS) {
      expect(Object.keys(allJackpot.jackpot.tiers)).toContain(t)
    }
  })

  it('haklar bitince tur kapanır (adım sayısı sınırlı)', () => {
    // stepCounts: hep 0 → hiç sembol eklenmez → 3 boş adım sonra biter
    const noFill: GameConfig = {
      ...linkCfg,
      link: { ...linkCfg.link, stepCounts: { 0: 1 } },
    }
    const trigger = Array.from({ length: 6 }, (_, i) => ({ reel: i % 5, row: 0 }))
    const bonus = playLinkBonus(noFill, createRng('end'), 100, trigger)
    // başlangıç + 3 boş adım
    expect(bonus.steps).toHaveLength(4)
    expect(bonus.steps.at(-1)!.respinsLeft).toBe(0)
    expect(bonus.cells).toHaveLength(6)
  })
})

describe('playFreeSpins', () => {
  it('3 scatter → award[3] dönüş, kazançlar çarpanla ödenir', () => {
    const cfg = stripConfig(['cherry', 'lemon', 'orange', 'grapes', 'watermelon'])
    const game = playFreeSpins(cfg, createRng('fs'), 100, 3)
    expect(game.spins).toHaveLength(cfg.freeSpins.award[3])
    expect(game.awardScatters).toBe(3)
    for (const s of game.spins) {
      expect(s.win).toBe(s.result.totalWin * cfg.freeSpins.multiplier)
    }
    const rawSum = game.spins.reduce((t, s) => t + s.result.totalWin, 0)
    expect(game.totalWin).toBe(rawSum * cfg.freeSpins.multiplier)
  })

  it('4 scatter → award[4], 5 scatter → award[5] dönüş', () => {
    const cfg = stripConfig(['cherry', 'lemon', 'orange', 'grapes', 'watermelon'])
    expect(playFreeSpins(cfg, createRng('a'), 100, 4).spins).toHaveLength(
      cfg.freeSpins.award[4],
    )
    expect(playFreeSpins(cfg, createRng('b'), 100, 5).spins).toHaveLength(
      cfg.freeSpins.award[5],
    )
  })

  it('FS içinde scatter gelirse retrigger +5 ekler (toplam 50 ile sınırlı)', () => {
    // her FS spininde 15 scatter → her spin retrigger üretir
    const scatterCfg = stripConfig(['scatter'])
    const game = playFreeSpins(scatterCfg, createRng('rt'), 100, 3)
    expect(game.retriggers).toBeGreaterThan(0)
    expect(game.spins.length).toBeGreaterThanOrEqual(10)
    expect(game.spins.length).toBeLessThanOrEqual(50) // retrigger guard'ı
  })

  it('scatter’sız şeritlerde retrigger olmaz', () => {
    const cfg = stripConfig(['cherry', 'lemon', 'orange', 'grapes', 'watermelon'])
    const game = playFreeSpins(cfg, createRng('no-rt'), 100, 3)
    expect(game.retriggers).toBe(0)
    expect(game.spins).toHaveLength(cfg.freeSpins.award[3])
  })

  it('deterministiktir', () => {
    const cfg = stripConfig(['cherry', 'lemon', 'scatter', 'grapes', 'watermelon'])
    expect(playFreeSpins(cfg, createRng('d'), 100, 3)).toEqual(
      playFreeSpins(cfg, createRng('d'), 100, 3),
    )
  })
})

describe('playRound (tur orkestrasyonu)', () => {
  it('toplam = base + jackpot + link + bell + freeSpins', () => {
    for (let i = 0; i < 200; i++) {
      const round = playRound(CLOVER_LINK_BELLS, createRng(`r${i}`), 200)
      const sum =
        round.base.totalWin +
        (round.jackpot?.win ?? 0) +
        (round.link?.totalWin ?? 0) +
        (round.bell?.totalWin ?? 0) +
        (round.freeSpins?.totalWin ?? 0)
      expect(round.totalWin).toBe(sum)
      expect(round.bet).toBe(200)
    }
  })

  it('scatter 3+ ise freeSpins üretilir, 2 ise üretilmez', () => {
    // FS zorunlu: her yer scatter
    const allScatter = stripConfig(['scatter'])
    const forced = playRound(allScatter, createRng('fs-force'), 100)
    expect(forced.freeSpins).not.toBeNull()
    expect(forced.freeSpins!.spins.length).toBeGreaterThanOrEqual(
      allScatter.freeSpins.award[3],
    )

    const noScatter = stripConfig(['cherry', 'lemon', 'orange', 'grapes', 'watermelon'])
    const quiet = playRound(noScatter, createRng('fs-none'), 100)
    expect(quiet.freeSpins).toBeNull()
  })

  it('6+ link varsa link bonusu üretilir', () => {
    // her makarada garanti ≥2 link → gridde en az 10
    const allLink = stripConfig(['link', 'link', 'link', 'link', 'cherry'])
    const round = playRound(allLink, createRng('link-force'), 100)
    expect(round.link).not.toBeNull()
    expect(round.link!.triggerCount).toBeGreaterThanOrEqual(6)
    expect(round.link!.totalWin).toBeGreaterThan(0)
  })

  it('aynı seed → birebir aynı tur (replay sözleşmesi)', () => {
    const a = playRound(CLOVER_LINK_BELLS, createRng('replay'), 200)
    const b = playRound(CLOVER_LINK_BELLS, createRng('replay'), 200)
    expect(a).toEqual(b)
  })
})
