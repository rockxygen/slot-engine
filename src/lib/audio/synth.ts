/// Prosedürel ses sentezi — saf sayı matematiği, harici ses dosyası yok.
///
/// Neden kod ile üretim? (Faz 8) Lisanslı gerçek paralı üründe ses varlıklarının
/// lisansı ayrı bir denetim konusudur; sentezlenmiş WAV'lar deterministiktir
/// (aynı kod → aynı baytlar), birim testiyle doğrulanır, repo boyutu minimal
/// kalır. Çıktı mono Float32 örnektir; `wavBytes` 16-bit PCM'e paketler.
/// `scripts/gen-audio.ts` sonuçları `public/audio/*.wav` dosyalarına yazar;
/// Phaser sahnesi `GameScene.preload` içinde yükler.

export const AUDIO_SAMPLE_RATE = 22050

export type SoundName =
  | 'spin'
  | 'reelstop'
  | 'scatter'
  | 'bell'
  | 'win'
  | 'bigwin'
  | 'link'
  | 'jackpot'

/// `public/audio/{name}.wav` — sahne preload ederken bu listeyi gezer.
export const SOUND_NAMES: readonly SoundName[] = [
  'spin',
  'reelstop',
  'scatter',
  'bell',
  'win',
  'bigwin',
  'link',
  'jackpot',
]

type Wave = 'sine' | 'triangle' | 'square' | 'saw'

/// Faz 0..1 üzerinde dalga formu değeri
function waveSample(wave: Wave, phase: number): number {
  const p = phase - Math.floor(phase)
  switch (wave) {
    case 'sine':
      return Math.sin(p * Math.PI * 2)
    case 'triangle':
      return p < 0.5 ? 4 * p - 1 : 3 - 4 * p
    case 'square':
      return p < 0.5 ? 1 : -1
    case 'saw':
      return 2 * p - 1
  }
}

/// Attack (doğrusal) + üstel salınım zarfı; `dur` sonunda ~-60 dB'e iner.
function envelope(t: number, dur: number, attack: number): number {
  if (t <= 0 || t >= dur) return 0
  const a = attack > 0 ? Math.min(1, t / attack) : 1
  if (t <= attack) return a
  const d = Math.exp((-5 * (t - attack)) / Math.max(dur - attack, 1e-6))
  return a * d
}

/// Deterministik gürültü kaynağı (mulberry32) — testler aynı baytları bekler.
function makeRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/// Karışım tamponu: tüm sesler bu üzerine yazılır, `finish()` tek sesi döndürür.
class Mix {
  private readonly buf: Float32Array

  constructor(
    readonly seconds: number,
    readonly sr: number,
  ) {
    this.buf = new Float32Array(Math.ceil(seconds * sr))
  }

  /// Dalga sesi; istenirse freq başlangıçtan sona log-glide eder.
  tone(o: {
    at: number
    dur: number
    freq: number
    toFreq?: number
    vol: number
    wave: Wave
    attack?: number
  }): void {
    const from = Math.round(o.at * this.sr)
    const n = Math.min(Math.round(o.dur * this.sr), this.buf.length - from)
    if (n <= 0 || from < 0) return
    const attack = o.attack ?? 0.005
    const f0 = o.freq
    const f1 = o.toFreq ?? o.freq
    let phase = 0
    for (let i = 0; i < n; i++) {
      const k = i / n
      const f = f0 * Math.pow(f1 / f0, k)
      phase += f / this.sr
      const s = waveSample(o.wave, phase)
      this.buf[from + i] += s * o.vol * envelope(i / this.sr, o.dur, attack)
    }
  }

  /// FM çan: taşıyıcı `freq`, bozucu `ratio×freq`, indeks üstel söner.
  bell(o: {
    at: number
    dur: number
    freq: number
    vol: number
    ratio?: number
    index?: number
    attack?: number
  }): void {
    const from = Math.round(o.at * this.sr)
    const n = Math.min(Math.round(o.dur * this.sr), this.buf.length - from)
    if (n <= 0 || from < 0) return
    const ratio = o.ratio ?? 1.41
    const index = o.index ?? 4
    const attack = o.attack ?? 0.004
    for (let i = 0; i < n; i++) {
      const t = i / this.sr
      const idx = index * Math.exp((-4 * t) / o.dur)
      const s = Math.sin(
        2 * Math.PI * o.freq * t +
          idx * Math.sin(2 * Math.PI * o.freq * ratio * t),
      )
      this.buf[from + i] += s * o.vol * envelope(t, o.dur, attack)
    }
  }

  /// Sweep'li alçak geçiren filtreli beyaz gürültü (whoosh / tık sesleri).
  noise(o: {
    at: number
    dur: number
    vol: number
    fromCut: number
    toCut: number
    attack?: number
  }): void {
    const from = Math.round(o.at * this.sr)
    const n = Math.min(Math.round(o.dur * this.sr), this.buf.length - from)
    if (n <= 0 || from < 0) return
    const seed = 0x5eed ^ Math.round(o.at * 1000) ^ Math.round(o.fromCut)
    const rng = makeRng(seed)
    const attack = o.attack ?? 0.01
    let lp = 0
    for (let i = 0; i < n; i++) {
      const k = i / n
      const cut = o.fromCut * Math.pow(o.toCut / o.fromCut, k)
      const alpha = 1 - Math.exp((-2 * Math.PI * cut) / this.sr)
      const white = rng() * 2 - 1
      lp += alpha * (white - lp)
      const t = i / this.sr
      this.buf[from + i] += lp * o.vol * envelope(t, o.dur, attack)
    }
  }

  /// Akor — toplam tepeyi sınırlamak için nota başına vol kökten bölünür.
  chord(
    freqs: readonly number[],
    o: { at: number; dur: number; vol: number; wave?: Wave; attack?: number },
  ): void {
    const vol = o.vol / Math.sqrt(freqs.length)
    for (const f of freqs) {
      this.tone({
        at: o.at,
        dur: o.dur,
        freq: f,
        vol,
        wave: o.wave ?? 'triangle',
        attack: o.attack,
      })
    }
  }

  /// Kuyruk sönümü + tepe normalizasyonu (0.85) → tüm sesler eşit yükseklikte.
  finish(): Float32Array {
    const fade = Math.min(Math.round(0.005 * this.sr), this.buf.length)
    for (let i = 0; i < fade; i++) {
      this.buf[this.buf.length - fade + i] *= i / fade
    }
    let peak = 0
    for (let i = 0; i < this.buf.length; i++) {
      const v = Math.abs(this.buf[i])
      if (v > peak) peak = v
    }
    if (peak > 0) {
      const g = 0.85 / peak
      for (let i = 0; i < this.buf.length; i++) this.buf[i] *= g
    }
    return this.buf
  }
}

const BUILDERS: Record<
  SoundName,
  { seconds: number; build: (m: Mix) => void }
> = {
  /// Çevirme: tavan→taban süpüren gürültü + alçak uğultu
  spin: {
    seconds: 0.85,
    build(m) {
      m.noise({ at: 0, dur: 0.8, vol: 0.5, fromCut: 5200, toCut: 380, attack: 0.05 })
      m.tone({ at: 0, dur: 0.8, freq: 110, toFreq: 55, vol: 0.22, wave: 'saw', attack: 0.04 })
      m.noise({ at: 0.05, dur: 0.6, vol: 0.1, fromCut: 1800, toCut: 900, attack: 0.1 })
    },
  },
  /// Makara duruşu: kısa ahşap tık + tını
  reelstop: {
    seconds: 0.12,
    build(m) {
      m.noise({ at: 0, dur: 0.015, vol: 0.5, fromCut: 6000, toCut: 3000, attack: 0.001 })
      m.tone({ at: 0, dur: 0.1, freq: 820, vol: 0.55, wave: 'sine', attack: 0.002 })
      m.tone({ at: 0, dur: 0.06, freq: 1640, vol: 0.18, wave: 'sine', attack: 0.002 })
    },
  },
  /// Scatter: parlayan yükselen zil dizisi
  scatter: {
    seconds: 1.15,
    build(m) {
      const notes = [1046.5, 1174.7, 1318.5, 1568, 1760, 2093] // C6..C7
      notes.forEach((f, i) =>
        m.bell({ at: i * 0.13, dur: 0.6, freq: f, vol: 0.4, ratio: 1.56, index: 3 }),
      )
      m.noise({ at: 0, dur: 0.35, vol: 0.12, fromCut: 3000, toCut: 8000, attack: 0.15 })
    },
  },
  /// Klasik slot çanı: hum + gövde + parıltı + vuruş
  bell: {
    seconds: 1.5,
    build(m) {
      m.noise({ at: 0, dur: 0.02, vol: 0.4, fromCut: 7000, toCut: 4000, attack: 0.001 })
      m.bell({ at: 0, dur: 1.4, freq: 784, vol: 0.5, ratio: 1.41, index: 5.5 })
      m.bell({ at: 0, dur: 1.4, freq: 392, vol: 0.28, ratio: 2.0, index: 3 })
      m.bell({ at: 0.01, dur: 1.0, freq: 1968, vol: 0.16, ratio: 1.41, index: 4 })
    },
  },
  /// Küçük kazanç: kısa yükselen arpej + kapanış akoru
  win: {
    seconds: 0.9,
    build(m) {
      const notes = [523.25, 659.26, 783.99, 1046.5] // C5 E5 G5 C6
      notes.forEach((f, i) =>
        m.tone({ at: i * 0.09, dur: 0.3, freq: f, vol: 0.4, wave: 'triangle', attack: 0.006 }),
      )
      m.chord([523.25, 659.26, 783.99], { at: 0.4, dur: 0.45, vol: 0.4 })
    },
  },
  /// Büyük kazanç fanfarı: gürültü yükselişi + üç akor darbesi + süsleme
  bigwin: {
    seconds: 2.0,
    build(m) {
      m.noise({ at: 0, dur: 0.5, vol: 0.18, fromCut: 500, toCut: 6500, attack: 0.3 })
      m.chord([523.25, 659.26, 783.99], { at: 0.45, dur: 0.22, vol: 0.4, wave: 'saw', attack: 0.01 })
      m.chord([698.46, 880, 1046.5], { at: 0.68, dur: 0.22, vol: 0.4, wave: 'saw', attack: 0.01 })
      m.chord([880, 1108.7, 1318.5], { at: 0.91, dur: 0.25, vol: 0.42, wave: 'saw', attack: 0.01 })
      m.chord([523.25, 659.26, 783.99, 1046.5], { at: 1.2, dur: 0.78, vol: 0.4, attack: 0.01 })
      m.bell({ at: 1.2, dur: 0.78, freq: 1046.5, vol: 0.3, ratio: 1.56, index: 3 })
      m.bell({ at: 1.35, dur: 0.6, freq: 1568, vol: 0.2, ratio: 1.56, index: 3 })
    },
  },
  /// Link bonus: saw süpürmesi + yükselen akorlar
  link: {
    seconds: 1.7,
    build(m) {
      m.tone({ at: 0, dur: 0.6, freq: 220, toFreq: 880, vol: 0.28, wave: 'saw', attack: 0.03 })
      m.noise({ at: 0, dur: 0.6, vol: 0.16, fromCut: 700, toCut: 7000, attack: 0.3 })
      m.chord([659.26, 830.6, 987.8], { at: 0.62, dur: 0.2, vol: 0.4, wave: 'saw', attack: 0.01 })
      m.chord([784, 987.8, 1174.7], { at: 0.85, dur: 0.2, vol: 0.4, wave: 'saw', attack: 0.01 })
      m.chord([1046.5, 1318.5, 1568], { at: 1.08, dur: 0.6, vol: 0.4, attack: 0.01 })
      m.bell({ at: 1.08, dur: 0.6, freq: 1046.5, vol: 0.3, ratio: 1.56, index: 3 })
    },
  },
  /// Jackpot: açılış akoru + sikke çağlayanı + uzun süs
  jackpot: {
    seconds: 2.6,
    build(m) {
      m.chord([523.25, 659.26, 783.99, 1046.5], { at: 0, dur: 0.5, vol: 0.4, wave: 'saw', attack: 0.01 })
      m.noise({ at: 0, dur: 0.45, vol: 0.16, fromCut: 800, toCut: 7000, attack: 0.25 })
      const coins = [2093, 1568, 2093, 1760, 2093, 1568, 2637, 2093]
      coins.forEach((f, i) =>
        m.bell({ at: 0.55 + i * 0.11, dur: 0.4, freq: f, vol: 0.3, ratio: 1.56, index: 2.5 }),
      )
      m.chord([523.25, 659.26, 783.99, 1046.5, 1318.5], { at: 1.5, dur: 1.05, vol: 0.38, attack: 0.01 })
      m.bell({ at: 1.5, dur: 1.05, freq: 1318.5, vol: 0.3, ratio: 1.41, index: 3.5 })
    },
  },
}

/// Tek sesi render et (deterministik).
export function renderSound(
  name: SoundName,
  sampleRate: number = AUDIO_SAMPLE_RATE,
): Float32Array {
  const { seconds, build } = BUILDERS[name]
  const m = new Mix(seconds, sampleRate)
  build(m)
  return m.finish()
}

function writeAscii(out: Uint8Array, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) out[offset + i] = text.charCodeAt(i)
}

/// Float32 mono örneği 16-bit PCM WAV'a paketler (44 bayt RIFF başlığı).
export function wavBytes(samples: Float32Array, sampleRate: number): Uint8Array {
  const dataLen = samples.length * 2
  const out = new Uint8Array(44 + dataLen)
  const dv = new DataView(out.buffer)
  writeAscii(out, 0, 'RIFF')
  dv.setUint32(4, 36 + dataLen, true)
  writeAscii(out, 8, 'WAVE')
  writeAscii(out, 12, 'fmt ')
  dv.setUint32(16, 16, true) // fmt chunk uzunluğu
  dv.setUint16(20, 1, true) // PCM
  dv.setUint16(22, 1, true) // mono
  dv.setUint32(24, sampleRate, true)
  dv.setUint32(28, sampleRate * 2, true) // byte rate
  dv.setUint16(32, 2, true) // block align
  dv.setUint16(34, 16, true) // bit derinliği
  writeAscii(out, 36, 'data')
  dv.setUint32(40, dataLen, true)
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]))
    dv.setInt16(44 + i * 2, Math.round(v * 32767), true)
  }
  return out
}
