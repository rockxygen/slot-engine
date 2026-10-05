import { describe, expect, it } from 'vitest'
import type { EntropySelfTest } from './entropy'
import {
  entropyStatus,
  resetEntropyCacheForTest,
  runEntropySelfTest,
  setEntropyOverrideForTest,
} from './entropy'
import { openDb } from './db'
import { performSpin } from './spin-service'
import { createSession, getBalance, listLedger } from './wallet'

/// RNG entropi sağlığı (Faz 7 · §7): kaynak CSPRNG, sağlık testi
/// zayıf kaynakları YAKALAMALI (yanlış-negatif yok), başarısızlıkta
/// performSpin yeni tur ÜRETEMEZ.

const FAILED: EntropySelfTest = {
  source: 'test',
  ok: false,
  failures: ['constant'],
  testedAt: new Date().toISOString(),
  bitsSampled: 0,
  onesRatio: 0,
}

/// 256 bayt örnekle
const sampleOf = (bytes: number[]): Uint8Array => Uint8Array.from(bytes)

describe('entropi sağlık testi (Faz 7)', () => {
  it('gerçek CSPRNG temiz geçer (Node crypto)', () => {
    const t = runEntropySelfTest()
    expect(t.ok).toBe(true)
    expect(t.failures).toEqual([])
    expect(t.source).toContain('getRandomValues')
    expect(t.bitsSampled).toBe(2048)
    expect(entropyStatus().ok).toBe(true)
  })

  it('ölü kaynak (tüm blok sıfır) → yakalanır', () => {
    const t = runEntropySelfTest(() => sampleOf(new Array(256).fill(0)))
    expect(t.ok).toBe(false)
    expect(t.failures).toContain('zero')
  })

  it('sabit akış (tek bayt) → yakalanır', () => {
    const t = runEntropySelfTest(() => sampleOf(new Array(256).fill(0xaa)))
    expect(t.ok).toBe(false)
    expect(t.failures).toContain('constant')
  })

  it('kısa periyot (dengeli ama tekrarlayan kelime) → repeat yakalanır', () => {
    // 0xAAAA5555: bit oranı %50 (monobit temiz) ama kelime hep aynı
    const bytes: number[] = []
    for (let i = 0; i < 64; i++) bytes.push(0xaa, 0xaa, 0x55, 0x55)
    const t = runEntropySelfTest(() => sampleOf(bytes))
    expect(t.ok).toBe(false)
    expect(t.failures).toContain('repeat')
    expect(t.failures).not.toContain('monobit')
    expect(t.failures).not.toContain('constant')
  })

  it('yarı-sabit akış (düşük bit oranı) → monobit yakalanır', () => {
    const bytes: number[] = []
    for (let i = 0; i < 128; i++) bytes.push(0x07, 0x00) // ~%19 ones
    const t = runEntropySelfTest(() => sampleOf(bytes))
    expect(t.ok).toBe(false)
    expect(t.failures).toContain('monobit')
  })

  it('sağlık başarısızken performSpin yeni tur RET eder, iz BIRAKMAZ', () => {
    resetEntropyCacheForTest()
    const db = openDb(':memory:')
    createSession(db, 'entropy-sess-1')
    const before = getBalance(db, 'entropy-sess-1')

    setEntropyOverrideForTest(FAILED)
    try {
      const out = performSpin(db, {
        sessionId: 'entropy-sess-1',
        bet: 200,
        clientRequestId: 'entropy-req-0001',
      })
      expect(out).toEqual({ ok: false, reason: 'rng_unhealthy' })
      // İz yok: bakiye aynı, ledger'da BET satırı yok
      expect(getBalance(db, 'entropy-sess-1')).toBe(before)
      expect(listLedger(db, 'entropy-sess-1')).toHaveLength(1) // OPENING
    } finally {
      setEntropyOverrideForTest(null)
    }

    // Kaynak düzelince aynı istek çalışır (kapı gerçekten koşullu)
    const ok = performSpin(db, {
      sessionId: 'entropy-sess-1',
      bet: 200,
      clientRequestId: 'entropy-req-0001',
    })
    expect(ok.ok).toBe(true)
  })

  it('sağlık başarısızken bile mevcut turun idempotent replay\'i çalışır (seed üretmez)', () => {
    resetEntropyCacheForTest()
    const db = openDb(':memory:')
    createSession(db, 'entropy-sess-2')

    const first = performSpin(db, {
      sessionId: 'entropy-sess-2',
      bet: 200,
      clientRequestId: 'entropy-req-0002',
    })
    expect(first.ok).toBe(true)

    setEntropyOverrideForTest(FAILED)
    try {
      const replay = performSpin(db, {
        sessionId: 'entropy-sess-2',
        bet: 200,
        clientRequestId: 'entropy-req-0002',
      })
      expect(replay.ok).toBe(true)
      if (first.ok && replay.ok) {
        expect(replay.roundId).toBe(first.roundId) // ikinci bahis çekilmedi
        expect(replay.balance).toBe(first.balance)
      }
    } finally {
      setEntropyOverrideForTest(null)
    }
  })
})
