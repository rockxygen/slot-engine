import { describe, expect, it } from 'vitest'
import { createRng, randomSeed } from './rng'

describe('rng (deterministik PRNG)', () => {
  it('aynı seed aynı zinciri üretir', () => {
    const a = createRng('spin:42')
    const b = createRng('spin:42')
    const seqA = Array.from({ length: 1000 }, () => a.nextUint())
    const seqB = Array.from({ length: 1000 }, () => b.nextUint())
    expect(seqA).toEqual(seqB)
  })

  it('farklı seed farklı zincir üretir', () => {
    const a = createRng('spin:1')
    const b = createRng('spin:2')
    expect(a.nextUint()).not.toBe(b.nextUint())
  })

  it('durum kaydet/devam ettir replay edilebilir', () => {
    const a = createRng('chain')
    a.nextUint()
    a.nextUint()
    const saved = a.state()

    const restOfA = Array.from({ length: 100 }, () => a.nextUint())
    const b = createRng('chain', saved)
    const restOfB = Array.from({ length: 100 }, () => b.nextUint())
    expect(restOfB).toEqual(restOfA)
  })

  it('nextInt asla maxın dışına çıkmaz ve tüm aralığı kapsar', () => {
    const rng = createRng('bounds')
    const seen = new Set<number>()
    for (let i = 0; i < 50_000; i++) {
      const v = rng.nextInt(7)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(7)
      seen.add(v)
    }
    expect(seen.size).toBe(7) // 0..6 tamamı görülür
  })

  it('nextInt ÖNYARGISIZ dağılır (kabul edilebilir χ²)', () => {
    const rng = createRng('uniform')
    const buckets = 10
    const n = 200_000
    const counts = new Array<number>(buckets).fill(0)
    for (let i = 0; i < n; i++) counts[rng.nextInt(buckets)]++

    const expected = n / buckets
    const chi2 = counts.reduce((s, c) => s + (c - expected) ** 2 / expected, 0)
    // 9 serbestlik derecesi, p=0.001 için kritik değer ≈ 27.88
    expect(chi2).toBeLessThan(27.88)
  })

  it('next() [0,1) aralığında', () => {
    const rng = createRng('unit')
    for (let i = 0; i < 10_000; i++) {
      const v = rng.next()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('nextInt geçersiz parametrede hata fırlatır', () => {
    const rng = createRng('err')
    expect(() => rng.nextInt(0)).toThrow(RangeError)
    expect(() => rng.nextInt(-3)).toThrow(RangeError)
    expect(() => rng.nextInt(2.5)).toThrow(RangeError)
  })
})

describe('randomSeed', () => {
  it('16 hex karakter üretir ve tekrarsızdır', () => {
    const seeds = new Set(Array.from({ length: 100 }, () => randomSeed()))
    expect(seeds.size).toBe(100)
    for (const s of seeds) expect(s).toMatch(/^[0-9a-f]{32}$/)
  })

  it('CSPRNG yoksa hata fırlatır — zayıf kaynağa (Math.random) sessiz düşüş YOK', () => {
    const holder = globalThis.crypto as unknown as { getRandomValues?: unknown }
    const original = holder.getRandomValues
    holder.getRandomValues = undefined
    try {
      expect(() => randomSeed()).toThrow(/CSPRNG/)
    } finally {
      holder.getRandomValues = original
    }
    // kaynak geri geldi → üretim devam
    expect(randomSeed()).toMatch(/^[0-9a-f]{32}$/)
  })
})
