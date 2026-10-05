import { describe, expect, it } from 'vitest'
import { CLOVER_LINK_BELLS } from './config'
import { SYMBOL_IDS } from './types'

describe('config (şerit üretimi)', () => {
  it('her şerit, ağırlıkların multiset’ini birebir korur', () => {
    const weights: Record<string, number> = {
      cherry: 6,
      lemon: 5,
      orange: 4,
      grapes: 4,
      watermelon: 3,
      seven: 2,
      bell: 2,
      wild: 1,
      scatter: 1,
      link: 4,
    }
    CLOVER_LINK_BELLS.strips.forEach((strip, reel) => {
      for (const symbol of SYMBOL_IDS) {
        const count = strip.filter((s) => s === symbol).length
        expect(count, `reel ${reel} × ${symbol}`).toBe(weights[symbol] ?? 0)
      }
      expect(strip).toHaveLength(32)
    })
  })

  it('wild/scatter eşit aralıklıdır (yığılmadan homojen dağılım)', () => {
    for (const strip of CLOVER_LINK_BELLS.strips) {
      for (const symbol of ['wild', 'scatter'] as const) {
        const positions = strip
          .map((s, i) => (s === symbol ? i : -1))
          .filter((i) => i >= 0)
        const gaps = positions.map((p, i) => {
          const next = i === positions.length - 1 ? positions[0] + strip.length : positions[i + 1]
          return next - p
        })
        // eşit aralık: boşluklar ortalamanın ±2 biriminde
        const mean = strip.length / positions.length
        for (const g of gaps) expect(Math.abs(g - mean)).toBeLessThanOrEqual(2)
      }
    }
  })

  it('grid EN AZ triggerCount link gösterebilmeli (aksi halde bonus ulaşılamaz)', () => {
    let maxTotal = 0
    for (const strip of CLOVER_LINK_BELLS.strips) {
      // tek pencerede yakalanabilecek en fazla link
      let best = 0
      for (let start = 0; start < strip.length; start++) {
        let n = 0
        for (let i = 0; i < CLOVER_LINK_BELLS.rows; i++) {
          if (strip[(start + i) % strip.length] === 'link') n++
        }
        if (n > best) best = n
      }
      maxTotal += best
    }
    expect(maxTotal).toBeGreaterThanOrEqual(CLOVER_LINK_BELLS.link.triggerCount + 1)
  })

  it('grid EN AZ bell.triggerCount çan gösterebilmeli (aksi halde bonus ulaşılamaz)', () => {
    // Çan bonusu (Faz 10): her makaranın en iyi penceresi en az 1 çan
    // göstermeli → 5 makarada toplam en az 5 çan (eşik: 5).
    let maxTotal = 0
    for (const strip of CLOVER_LINK_BELLS.strips) {
      let best = 0
      for (let start = 0; start < strip.length; start++) {
        let n = 0
        for (let i = 0; i < CLOVER_LINK_BELLS.rows; i++) {
          if (strip[(start + i) % strip.length] === 'bell') n++
        }
        if (n > best) best = n
      }
      maxTotal += best
    }
    expect(maxTotal).toBeGreaterThanOrEqual(CLOVER_LINK_BELLS.bell.triggerCount)
  })

  it('çizgi indeksleri satır aralığında ve makara sayısı kadar', () => {
    for (const line of CLOVER_LINK_BELLS.lines) {
      expect(line).toHaveLength(CLOVER_LINK_BELLS.reelCount)
      for (const row of line) {
        expect(row).toBeGreaterThanOrEqual(0)
        expect(row).toBeLessThan(CLOVER_LINK_BELLS.rows)
      }
    }
    expect(CLOVER_LINK_BELLS.lines).toHaveLength(20)
    // çizgiler benzersiz olmalı
    const keys = CLOVER_LINK_BELLS.lines.map((l) => l.join(''))
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('toplam bahis her zaman çizgi sayısına bölünür (tamsayı para)', () => {
    // bet = lineBet × 20; lineBet her tam sayı olabilmeli
    expect(CLOVER_LINK_BELLS.lines.length).toBe(20)
  })
})
