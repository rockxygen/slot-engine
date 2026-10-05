/// Deterministik, seed'li PRNG — sfc32 (Dotson-Huston) + xmur3 tohum
/// genişletme. Salt 32-bit tam sayı aritmetiği kullanır (Math.imul):
/// aynı seed her platformda AYNI zinciri üretir. Bu, replay, denetim
/// (seed zinciri kaydı) ve tekrarlanabilir testler için şarttır.

/// RNG'nin kaydedilebilir/geri yüklenebilir iç durumu
export type RngState = readonly [number, number, number, number]

export interface Rng {
  /// Ham 32-bit çıktı: [0, 2^32)
  nextUint(): number
  /// [0, 1) arası kayan nokta
  next(): number
  /// [0, max) arası tam sayı, reddetme örneklemeyle ÖNYARGISIZ
  nextInt(max: number): number
  /// O ANKI iç durum (createRng(seed, state) ile oradan devam edilir)
  state(): RngState
}

///xmur3: string → 4×32-bit tohum (Avalanche'lı hash)
function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    h ^= h >>> 16
    return h >>> 0
  }
}

/// Seed'den ilk durumu üretir (xmur3 → 4 kelime)
function seedToState(seed: string): RngState {
  const h = xmur3(seed)
  return [h(), h(), h(), h()]
}

/// Isınma turu: ilk çıktıların tohum izini dağıtmak için
const WARMUP = 16

/**
 * Seed'den deterministik RNG üretir. Aynı seed → aynı zincir.
 * `state` verilirse kayıtlı durumdan ATLANMADAN devam eder
 * (spin zinciri / replay / denetim).
 *
 * sfc32 adımı doğrudan burada: `state()` çağırdığı anki GÜNCEL
 * a,b,c,d'yi döndürür → kaydet/geri yükle birebir aynı zinciri sürdürür.
 */
export function createRng(seed: string, state?: RngState): Rng {
  let [a, b, c, d] = state ?? seedToState(seed)

  const nextUint = (): number => {
    const t = (((a + b) | 0) + d) | 0
    d = (d + 1) | 0
    a = b ^ (b >>> 9)
    b = (c + (c << 3)) | 0
    c = (c << 21) | (c >>> 11)
    c = (c + t) | 0
    return t >>> 0
  }

  // Isınma yalnızca taze tohumda; kayıtlı durumdan devam ederken atlanır
  if (!state) for (let i = 0; i < WARMUP; i++) nextUint()

  const next = (): number => nextUint() / 4294967296

  const nextInt = (max: number): number => {
    if (!Number.isInteger(max) || max <= 0) {
      throw new RangeError(`nextInt: max [1, 2^31) aralığında olmalı, aldı: ${max}`)
    }
    // Reddetme örnekleme: 2^32'nin max'a bölümünün katına kadar atılır
    // → mod alma kaynaklı bölsel önyargı kalmaz.
    const limit = Math.floor(4294967296 / max) * max
    let v = nextUint()
    while (v >= limit) v = nextUint()
    return v % max
  }

  return {
    nextUint,
    next,
    nextInt,
    state: () => [a, b, c, d] as RngState,
  }
}

/// Sunucu/istemci için rastgele seed (denetimde hash'lenip saklanır).
/// YALNIZCA CSPRNG: `getRandomValues` yoksa bilerek hata fırlatır —
/// zayıf bir kaynağa (Math.random) sessiz düşüş lisanslı üründe
/// denetim ihlalidir (GLI-19 RNG kaynağı şartı).
export function randomSeed(): string {
  const bytes = new Uint8Array(16)
  if (typeof globalThis.crypto?.getRandomValues !== 'function') {
    throw new Error(
      'randomSeed: CSPRNG (crypto.getRandomValues) yok — seed üretilemedi',
    )
  }
  globalThis.crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}
