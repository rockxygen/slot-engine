import { describe, expect, it } from 'vitest'
import {
  formatMinuteInput,
  formatMinorInput,
  limitSummaryLines,
  parseMinuteInput,
  parseMinorInput,
} from './limit-input'

/// Limit paneli giriş dönüşümleri (Faz 7 UI): tr-TR gösterim ↔ sunucu
/// sözleşmesi (kuruş / saniye / null = sınırsız).

describe('parseMinorInput — ₺ girişi → kuruş', () => {
  it('boş alan = sınırsız bırak (null)', () => {
    expect(parseMinorInput('')).toEqual({ ok: true, value: null })
    expect(parseMinorInput('   ')).toEqual({ ok: true, value: null })
  })

  it('tam sayı ₺ → ×100 kuruş', () => {
    expect(parseMinorInput('500')).toEqual({ ok: true, value: 50000 })
    expect(parseMinorInput('1')).toEqual({ ok: true, value: 100 })
  })

  it('virgül ondalık, nokta binlik (tr-TR)', () => {
    expect(parseMinorInput('500,50')).toEqual({ ok: true, value: 50050 })
    expect(parseMinorInput('1.500')).toEqual({ ok: true, value: 150000 })
    expect(parseMinorInput('1.500,25')).toEqual({ ok: true, value: 150025 })
    expect(parseMinorInput('  500,5  ')).toEqual({ ok: true, value: 50050 })
  })

  it('geçersiz giriş reddedilir', () => {
    for (const bad of ['abc', '50₺', '12,345', '1.2.3', '1,2,3', '-5', '1e5']) {
      expect(parseMinorInput(bad).ok).toBe(false)
    }
    expect(parseMinorInput('0').ok).toBe(false) // en az 1 kuruş
    expect(parseMinorInput('0,004').ok).toBe(false) // yuvarlayınca 0
    expect(parseMinorInput('10000001').ok).toBe(false) // 1e9 minor üst sınırı
  })
})

describe('parseMinuteInput — dakika girişi → saniye', () => {
  it('boş = sınırsız', () => {
    expect(parseMinuteInput('')).toEqual({ ok: true, value: null })
  })

  it('dakika → saniye (ondalık virgül kabul)', () => {
    expect(parseMinuteInput('60')).toEqual({ ok: true, value: 3600 })
    expect(parseMinuteInput('1')).toEqual({ ok: true, value: 60 })
    expect(parseMinuteInput('1,5')).toEqual({ ok: true, value: 90 })
  })

  it('geçersiz giriş reddedilir', () => {
    for (const bad of ['abc', '-5', '0', 'saat', '1,2,3']) {
      expect(parseMinuteInput(bad).ok).toBe(false)
    }
  })
})

describe('biçimlendirme (görüntüleme)', () => {
  it('kuruş → ₺ metni', () => {
    expect(formatMinorInput(50050)).toBe('500,50')
    expect(formatMinorInput(100)).toBe('1,00')
    expect(formatMinorInput(null)).toBe('')
  })

  it('saniye → dakika metni', () => {
    expect(formatMinuteInput(3600)).toBe('60')
    expect(formatMinuteInput(90)).toBe('1,5')
    expect(formatMinuteInput(null)).toBe('')
  })

  it('özet satırları: null = Sınırsız', () => {
    const lines = limitSummaryLines({
      lossLimit: null,
      spendLimit: 50000,
      sessionLimitSec: 3600,
    })
    expect(lines[0].text).toBe('Sınırsız')
    expect(lines[1].text).toBe('500,00 ₺')
    expect(lines[2].text).toBe('60 dk')
  })
})
