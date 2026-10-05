import { describe, expect, it } from 'vitest'
import {
  AUDIO_SAMPLE_RATE,
  SOUND_NAMES,
  renderSound,
  wavBytes,
} from './synth'

/// Prosedürel ses sentezi (Faz 8): determinizm, sonluluk, işitilirlik
/// ve WAV paketleme sözleşmesi.

describe('ses sentezi (Faz 8)', () => {
  it('her ses deterministiktir ve aynı uzunlukta render edilir', () => {
    for (const name of SOUND_NAMES) {
      const a = renderSound(name)
      const b = renderSound(name)
      expect(a.length).toBe(b.length)
      expect(a.length).toBeGreaterThan(0)
      // determinizm: iki render birebir aynı örneklere sahip
      expect(Array.from(a)).toEqual(Array.from(b))
    }
  })

  it('tüm örneklar sonlu, tepe 0.85±, sesler duyulabilir seviyede', () => {
    for (const name of SOUND_NAMES) {
      const s = renderSound(name)
      let peak = 0
      for (const v of s) {
        expect(Number.isFinite(v)).toBe(true)
        const av = Math.abs(v)
        if (av > peak) peak = av
      }
      expect(peak).toBeCloseTo(0.85, 3) // finish() normalizasyonu
      expect(peak).toBeLessThanOrEqual(1)
    }
  })

  it('kuyruk sönümlenmiştir (bitişte tıklama yok)', () => {
    for (const name of SOUND_NAMES) {
      const s = renderSound(name)
      const tail = s.slice(-Math.round(0.001 * AUDIO_SAMPLE_RATE))
      for (const v of tail) expect(Math.abs(v)).toBeLessThan(0.01)
    }
  })

  it('wavBytes: RIFF/WAVE + 16-bit mono PCM başlığı ve doğru data boyutu', () => {
    const s = renderSound('reelstop')
    const w = wavBytes(s, AUDIO_SAMPLE_RATE)
    const dv = new DataView(w.buffer)
    const ascii = (from: number, len: number): string =>
      String.fromCharCode(...w.slice(from, from + len))

    expect(w.length).toBe(44 + s.length * 2)
    expect(ascii(0, 4)).toBe('RIFF')
    expect(ascii(8, 4)).toBe('WAVE')
    expect(dv.getUint32(4, true)).toBe(36 + s.length * 2)
    expect(dv.getUint16(20, true)).toBe(1) // PCM
    expect(dv.getUint16(22, true)).toBe(1) // mono
    expect(dv.getUint32(24, true)).toBe(AUDIO_SAMPLE_RATE)
    expect(dv.getUint16(34, true)).toBe(16) // bit derinliği
    expect(ascii(36, 4)).toBe('data')
    expect(dv.getUint32(40, true)).toBe(s.length * 2)
  })

  it('toplam ses süresi makul sınırlarda (kurulum yükü az)', () => {
    let total = 0
    for (const name of SOUND_NAMES) {
      total += renderSound(name).length / AUDIO_SAMPLE_RATE
    }
    expect(total).toBeGreaterThan(5)
    expect(total).toBeLessThan(15)
  })

  it('ses adları benzersizdir ve bilinen seti oluşturur', () => {
    expect(new Set(SOUND_NAMES).size).toBe(SOUND_NAMES.length)
    expect([...SOUND_NAMES].sort()).toEqual(
      ['bell', 'bigwin', 'jackpot', 'link', 'reelstop', 'scatter', 'spin', 'win'],
    )
  })
})
