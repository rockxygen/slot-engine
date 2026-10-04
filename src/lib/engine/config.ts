import { createRng } from './rng'
import { SYMBOL_IDS, type GameConfig, type SymbolId } from './types'

/// ============================================================
/// Clover Link Bells — oyun matematiği (VERİ, kod değil)
/// 5 makara × 3 satır, 20 çizgi, both-ways kapalı.
/// Para minor birimdedir (kuruş); tüm kazançlar TAMSAYI.
/// ============================================================

/// Makaralara sembol dağılımı (her makara için ağırlıklar).
/// Toplam 28 birim → şeritler deterministik olarak genişletilir.
const WEIGHTS: Readonly<Record<SymbolId, number>> = {
  cherry: 6,
  lemon: 5,
  orange: 4,
  grapes: 4,
  watermelon: 3,
  seven: 2,
  bell: 2,
  wild: 1,
  scatter: 1,
}

/**
 * Ağırlıkları sabit şeride genişletir + sabit tohumla Fisher-Yates
 * karıştırır. Tohum `strip:<oyun>:<makara>` olduğu için üretim
 * ortamından bağımsız, DENETLENEBİLİR çıktı verir: aynı kod → aynı şerit.
 */
function buildStrips(game: string, reelCount: number): SymbolId[][] {
  const base = SYMBOL_IDS.filter((s) => WEIGHTS[s] > 0)
  const strips: SymbolId[][] = []
  for (let reel = 0; reel < reelCount; reel++) {
    const strip: SymbolId[] = []
    for (const symbol of base) {
      for (let i = 0; i < WEIGHTS[symbol]; i++) strip.push(symbol)
    }
    const rng = createRng(`strip:${game}:${reel}`)
    for (let i = strip.length - 1; i > 0; i--) {
      const j = rng.nextInt(i + 1)
      ;[strip[i], strip[j]] = [strip[j], strip[i]]
    }
    strips.push(strip)
  }
  return strips
}

/// 20 kazanç çizgisi (satır indeksleri, 0=üst, 2=alt)
const LINES: readonly (readonly number[])[] = [
  [1, 1, 1, 1, 1], // merkez
  [0, 0, 0, 0, 0], // üst
  [2, 2, 2, 2, 2], // alt
  [0, 1, 2, 1, 0], // V
  [2, 1, 0, 1, 2], // A
  [0, 0, 1, 2, 2],
  [2, 2, 1, 0, 0],
  [1, 0, 0, 0, 1],
  [1, 2, 2, 2, 1],
  [0, 1, 0, 1, 0],
  [2, 1, 2, 1, 2],
  [1, 0, 1, 0, 1],
  [1, 2, 1, 2, 1],
  [0, 0, 1, 0, 0],
  [2, 2, 1, 2, 2],
  [0, 1, 1, 1, 0],
  [2, 1, 1, 1, 2],
  [1, 1, 0, 0, 0],
  [1, 1, 2, 2, 2],
  [0, 1, 2, 2, 2],
]

/// Satır kazanç çarpanları — lineBet üzerinden (ör. 5 × bell = 300×lineBet)
const PAYTABLE = {
  wild: { 3: 20, 4: 100, 5: 500 },
  bell: { 3: 15, 4: 60, 5: 300 },
  seven: { 3: 10, 4: 50, 5: 250 },
  watermelon: { 3: 6, 4: 25, 5: 120 },
  grapes: { 3: 5, 4: 20, 5: 100 },
  orange: { 3: 4, 4: 15, 5: 75 },
  lemon: { 3: 3, 4: 10, 5: 50 },
  cherry: { 3: 2, 4: 8, 5: 40 },
} as const

export const CLOVER_LINK_BELLS: GameConfig = {
  name: 'clover-link-bells',
  reelCount: 5,
  rows: 3,
  bothWays: false,
  strips: buildStrips('clover-link-bells', 5),
  lines: LINES,
  paytable: PAYTABLE,
  scatter: { symbol: 'scatter', pays: { 3: 2, 4: 10, 5: 50 } },
  wild: 'wild',
}

/// Tüm çizgi toplam bahsi bölerken tam bölünme şart (tamsayı para)
export const LINE_COUNT = CLOVER_LINK_BELLS.lines.length
