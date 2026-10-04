import { createRng, type Rng } from './rng'
import { SYMBOL_IDS, type FreeSpinConfig, type GameConfig, type LinkConfig, type SymbolId } from './types'

/// ============================================================
/// Clover Link Bells — oyun matematiği (VERİ, kod değil)
/// 5 makara × 3 satır, 20 çizgi, both-ways AÇIK.
/// Para minor birimdedir (kuruş); tüm kazançlar TAMSAYI.
/// ============================================================

/// Makaralara sembol dağılımı (her makara için ağırlıklar).
/// Toplam 31 birim → şeritler deterministik olarak genişletilir.
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
  link: 4,
}

/// Bonus tetikleyicileri şeritte EŞİT ARALIKLI durur. Rastgele shuffle'da
/// semboller yığınlanır → 5+ scatter'da clamp'e takılan aşırı ödemeler
/// çıkar. DİKKAT: `link` bilinçli olarak ARALIKLI DEĞİL — 6+ tetiklemesi
/// için tek pencerede 2 link yakalanabilmesi gerekir; eşit aralık bunu
/// imkânsız kılar (makara başına max 1 → gridde max 5).
const SPREAD_SYMBOLS: ReadonlySet<SymbolId> = new Set(['wild', 'scatter'])

/// `symbol`ün şeritteki tüm kopyalarını eşit aralıklı hedeflere yerleştirir
/// (sadece nadir semboller için çağrılır; şerit multiset'i DEĞİŞMEZ).
function spreadSymbol(strip: SymbolId[], symbol: SymbolId, rng: Rng): void {
  const len = strip.length
  const count = strip.reduce((n, s) => n + (s === symbol ? 1 : 0), 0)
  if (count === 0 || count >= len) return

  const step = len / count
  const phase = rng.nextInt(len)
  const targets = new Set<number>()
  for (let i = 0; i < count; i++) {
    let pos = Math.floor(phase + i * step) % len
    while (targets.has(pos)) pos = (pos + 1) % len // yuvarlama çakışması
    targets.add(pos)
  }

  for (const t of targets) {
    if (strip[t] === symbol) continue
    // hedefte olmayan bir kopyayı hedefe taşı (multiset korunur)
    const j = strip.findIndex((s, idx) => s === symbol && !targets.has(idx))
    if (j < 0) return // sayılar eşit olduğu için ulaşılmaz
    ;[strip[t], strip[j]] = [strip[j], strip[t]]
  }
}

/**
 * Ağırlıkları sabit şeride genişletir + sabit tohumla Fisher-Yates
 * karıştırır, ardından nadir sembolleri eşit aralığa serer. Tohum
 * `strip:<oyun>:<makara>` olduğu için üretim ortamından bağımsız,
 * DENETLENEBİLİR çıktı verir: aynı kod → aynı şerit.
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
    for (const symbol of base) {
      if (SPREAD_SYMBOLS.has(symbol)) spreadSymbol(strip, symbol, rng)
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

/// Satır kazanç çarpanları — lineBet üzerinden (ör. 5 × bell = 480×lineBet)
/// both-ways açıkken LTR+RTL toplamı da RTP'ye eklenir → çarpanlar
/// tek yönlü modele göre düşük tutulur.
const PAYTABLE = {
  wild: { 3: 35, 4: 175, 5: 800 },
  bell: { 3: 25, 4: 95, 5: 480 },
  seven: { 3: 17, 4: 80, 5: 400 },
  watermelon: { 3: 10, 4: 40, 5: 190 },
  grapes: { 3: 8, 4: 35, 5: 160 },
  orange: { 3: 7, 4: 25, 5: 120 },
  lemon: { 3: 5, 4: 17, 5: 80 },
  cherry: { 3: 4, 4: 14, 5: 60 },
} as const

/// Link respin bonusu (Hold & Win tarzı): 6+ sembol → 3 hak,
/// boş adımda hak azalır, dolu adımda sıfırlanır. Değerler bet
/// çarpanıdır; çok küçük bir şansla jackpot kademesi düşer.
const LINK: LinkConfig = {
  symbol: 'link',
  triggerCount: 6,
  respinCount: 3,
  cellCount: 15, // 5 makara × 3 satır
  values: { 0.5: 33, 1: 30, 2: 19, 3: 11, 5: 5, 10: 2 },
  jackpotChance: 0.03,
  jackpots: {
    mini: { weight: 45, multiplier: 10 },
    minor: { weight: 35, multiplier: 20 },
    major: { weight: 16, multiplier: 100 },
    grand: { weight: 4, multiplier: 500 },
  },
  stepCounts: { 0: 30, 1: 35, 2: 25, 3: 10 },
}

/// Free spins: 3+ scatter → 13/19/26 dönüş, tüm kazançlar ×4.
/// FS içinde 3+ scatter tekrar +5 ekler (retrigger).
const FREE_SPINS: FreeSpinConfig = {
  award: { 3: 13, 4: 19, 5: 26 },
  multiplier: 4,
  retriggerAward: 5,
}

export const CLOVER_LINK_BELLS: GameConfig = {
  name: 'clover-link-bells',
  reelCount: 5,
  rows: 3,
  bothWays: true,
  strips: buildStrips('clover-link-bells', 5),
  lines: LINES,
  paytable: PAYTABLE,
  scatter: { symbol: 'scatter', pays: { 3: 2, 4: 10, 5: 50 } },
  wild: 'wild',
  link: LINK,
  freeSpins: FREE_SPINS,
}

/// Tüm çizgi toplam bahsi bölerken tam bölünme şart (tamsayı para)
export const LINE_COUNT = CLOVER_LINK_BELLS.lines.length
