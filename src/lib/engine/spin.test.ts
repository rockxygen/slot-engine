import { describe, expect, it } from 'vitest'
import { CLOVER_LINK_BELLS } from './config'
import { spin } from './spin'
import { createRng } from './rng'
import { simulate } from './simulate'
import { toRows } from './reels'

describe('spin (entegrasyon)', () => {
  it('aynı seed → birebir aynı sonuç (replay)', () => {
    const a = spin(CLOVER_LINK_BELLS, createRng('replay-1'), 100)
    const b = spin(CLOVER_LINK_BELLS, createRng('replay-1'), 100)
    expect(a).toEqual(b)
  })

  it('farklı seed → farklı grid', () => {
    const a = spin(CLOVER_LINK_BELLS, createRng('replay-1'), 100)
    const b = spin(CLOVER_LINK_BELLS, createRng('replay-2'), 100)
    expect(a.columns).not.toEqual(b.columns)
  })

  it('grid boyutları 5×3 ve şerit sembollerinden geliyor', () => {
    const r = spin(CLOVER_LINK_BELLS, createRng('shape'), 100)
    expect(r.columns).toHaveLength(5)
    for (const col of r.columns) expect(col).toHaveLength(3)

    // her sütun, ilgili makaranın şeridinde bir yerde ARDIŞIK pencere olmalı
    r.columns.forEach((col, reel) => {
      const strip = CLOVER_LINK_BELLS.strips[reel]
      const isWindow = strip.some((_, start) =>
        col.every((s, i) => strip[(start + i) % strip.length] === s),
      )
      expect(isWindow, `sütun ${reel} şeritte ardışık pencere değil`).toBe(true)
    })
  })

  it('toplam kazanç = satır kazançları + scatter', () => {
    const rng = createRng('sum')
    for (let i = 0; i < 500; i++) {
      const r = spin(CLOVER_LINK_BELLS, rng, 200)
      const sum = r.lineWins.reduce((s, w) => s + w.win, 0) + (r.scatterWin?.win ?? 0)
      expect(r.totalWin).toBe(sum)
      expect(r.totalWin).toBeGreaterThanOrEqual(0)
    }
  })

  it('geçersiz bet hata fırlatır', () => {
    expect(() => spin(CLOVER_LINK_BELLS, createRng('x'), 0)).toThrow()
    expect(() => spin(CLOVER_LINK_BELLS, createRng('x'), 15)).toThrow() // 15 % 20 ≠ 0
  })

  it('toRows gridi satır bazlı döndürür', () => {
    const r = spin(CLOVER_LINK_BELLS, createRng('rows'), 100)
    const rows = toRows(r.columns)
    expect(rows).toHaveLength(3)
    expect(rows[0]).toHaveLength(5)
    expect(rows[1][0]).toBe(r.columns[0][1])
  })
})

describe('simulate (RTP harness)', () => {
  it('RTP makul aralıkta ve çıktı tutarlı', () => {
    const stats = simulate(CLOVER_LINK_BELLS, {
      spins: 50_000,
      seed: 'test-rtp',
      bet: 100,
    })
    expect(stats.totalBet).toBe(50_000 * 100)
    expect(stats.totalWin).toBeGreaterThanOrEqual(0)
    expect(stats.rtp).toBeGreaterThan(0.2)
    expect(stats.rtp).toBeLessThan(1.5)
    // hit rate ile kazançlı spin sayısı tutarlı
    expect(stats.hitRate).toBeGreaterThan(0)
    expect(stats.hitRate).toBeLessThan(1)
  })

  it('deterministiktir: aynı seed aynı istatistiği verir', () => {
    const opts = { spins: 10_000, seed: 'det', bet: 100 }
    expect(simulate(CLOVER_LINK_BELLS, opts)).toEqual(simulate(CLOVER_LINK_BELLS, opts))
  })

  it('geçersiz parametreleri reddeder', () => {
    expect(() =>
      simulate(CLOVER_LINK_BELLS, { spins: 0, seed: 'x', bet: 100 }),
    ).toThrow(RangeError)
    expect(() =>
      simulate(CLOVER_LINK_BELLS, { spins: 10, seed: 'x', bet: 15 }),
    ).toThrow(RangeError)
  })
})
