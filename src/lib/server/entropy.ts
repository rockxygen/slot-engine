/// ─────────────────────────────────── RNG entropi sağlığı (Faz 7 · §7)
///
/// GLI-19 tipi denetimde üretim RNG'sinin kaynağı BELGELİ ve SAĞLIK
/// TESTLERİNDEN geçmek zorundadır. Buradaki sözleşme:
///
///  • Kaynak: `crypto.getRandomValues` (CSPRNG). `randomSeed()` bunun
///    yokluğunda **hata fırlatır** — zayıf kaynağa sessiz düşüş yok.
///  • Sağlık testi: kaynaktan örneklenen blok üzerinde (NIST SP800-90B
///    kısaltılmış testleri benzeri) sabit-akış / sıfır-blok / tekrar /
///    monobit kontrolleri. Başarısızlık → oyun OYNATMAZ (performSpin
///    `rng_unhealthy` ile durur).
///  • Test enjeksiyonu: `setEntropyOverrideForTest` ile zayıf kaynak
///    senaryosu DOĞRULANABİLİR (yanlış-negatif yok).

export interface EntropySelfTest {
  readonly source: string
  readonly ok: boolean
  /// Başarısız kontrol adları (boş = temiz)
  readonly failures: readonly string[]
  readonly testedAt: string
  /// Örnekleme boyutu (bit) — rapor için
  readonly bitsSampled: number
  readonly onesRatio: number
}

export const ENTROPY_SOURCE = 'crypto.getRandomValues (CSPRNG)'

/// Varsayılan örnekleyici: 64 kelime (256 bayt) tek seferde
function defaultSample(): Uint8Array {
  const bytes = new Uint8Array(256)
  globalThis.crypto.getRandomValues(bytes)
  return bytes
}

/**
 * Sağlık testi — saf fonksiyon (örnekleyici enjekte edilebilir).
 *
 * Kontroller:
 *  • `zero`    — tüm blok sıfır (ölü kaynak)
 *  • `constant` — tüm baytlar aynı (sabit akış)
 *  • `repeat`  — 32-bit kelime tekrarı (kısa periyotlu üreteç)
 *  • `monobit` — bit oranı [0.40, 0.60] dışında (yarı-sabit akış)
 */
export function runEntropySelfTest(
  sample: () => Uint8Array = defaultSample,
): EntropySelfTest {
  const bytes = sample()
  const failures: string[] = []

  const allZero = bytes.every((b) => b === 0)
  if (allZero) failures.push('zero')

  const constant = bytes.length > 0 && bytes.every((b) => b === bytes[0])
  if (constant && !allZero) failures.push('constant')

  // 32-bit kelimeler (little-endian sayımdan bağımsız — bayt birleşimi)
  const words: number[] = []
  for (let i = 0; i + 4 <= bytes.length; i += 4) {
    const w =
      (bytes[i] << 24) |
      (bytes[i + 1] << 16) |
      (bytes[i + 2] << 8) |
      bytes[i + 3]
    words.push(w)
  }
  if (new Set(words).size !== words.length) failures.push('repeat')

  let ones = 0
  for (const b of bytes) {
    let v = b
    while (v) {
      ones += v & 1
      v >>= 1
    }
  }
  const bits = bytes.length * 8
  const onesRatio = bits > 0 ? ones / bits : 0
  if (onesRatio < 0.4 || onesRatio > 0.6) failures.push('monobit')

  return {
    source: ENTROPY_SOURCE,
    ok: failures.length === 0,
    failures,
    testedAt: new Date().toISOString(),
    bitsSampled: bits,
    onesRatio,
  }
}

/// Süreç-özel durum: ilk istekte bir kez test edilir, önbelleklenir.
let cached: EntropySelfTest | null = null
/// Test kancası: performSpin kapısını zayıf-kaynak senaryosuyla sınamak
let override: EntropySelfTest | null = null

export function entropyStatus(): EntropySelfTest {
  if (override) return override
  if (!cached) cached = runEntropySelfTest()
  return cached
}

export function setEntropyOverrideForTest(t: EntropySelfTest | null): void {
  override = t
}

export function resetEntropyCacheForTest(): void {
  cached = null
  override = null
}
