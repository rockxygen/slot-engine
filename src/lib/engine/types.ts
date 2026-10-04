/// Semboller oyunun VERİSİDİR; motor kodu sembol adlarına göre dallanmaz.
/// Yeni sembol eklemek = config'e eklemek, kodu değiştirmek değil.
export type SymbolId =
  | 'wild'
  | 'scatter'
  | 'link'
  | 'bell'
  | 'seven'
  | 'watermelon'
  | 'grapes'
  | 'orange'
  | 'lemon'
  | 'cherry'

export const SYMBOL_IDS: readonly SymbolId[] = [
  'wild',
  'scatter',
  'link',
  'bell',
  'seven',
  'watermelon',
  'grapes',
  'orange',
  'lemon',
  'cherry',
]

/// count → çarpan. Satır kazançlarında lineBet, scatter'da totalBet
/// üzerine vurulur. Anahtarlar kaç sembolde kazandığını belirtir (min 2).
export type PayRow = Readonly<Record<number, number>>

export interface ScatterRule {
  readonly symbol: SymbolId
  /// 3+ sembolde öder (scatter her makarada görünebilir, çizgi bağımsız)
  readonly pays: PayRow
}

/// Jackpot kademeleri — Link bonusunda sabit bahis katlarıyla öder
export type JackpotTier = 'mini' | 'minor' | 'major' | 'grand'

export interface JackpotRule {
  /// Kademe ağırlığı (toplam jackpot şansının dağılımı)
  readonly weight: number
  /// Bet çarpanı (mini 10×, grand 500× gibi)
  readonly multiplier: number
}

export interface LinkConfig {
  readonly symbol: SymbolId
  /// Bu kadar + link sembolü griddeyse bonus tetiklenir
  readonly triggerCount: number
  /// Her boş adımda sıfırlanan hak (başlangıç dahil)
  readonly respinCount: number
  /// Toplam hücre (reelCount × rows); hepsi dolarsa `full` olur
  readonly cellCount: number
  /// Normal sembol değeri → ağırlık (değer = bet çarpanı)
  readonly values: Readonly<Record<number, number>>
  /// Yerleşen bir sembolün jackpot KADEMESİ olma olasılığı [0,1)
  readonly jackpotChance: number
  readonly jackpots: Readonly<Record<JackpotTier, JackpotRule>>
  /// Adımda eklenen sembol sayısı → ağırlık (0 = boş adım → hak azalır)
  readonly stepCounts: Readonly<Record<number, number>>
}

export interface FreeSpinConfig {
  /// Scatter sayısı → verilen bedava dönüş
  readonly award: Readonly<Record<number, number>>
  /// Tüm bedava dönüş kazançları bu çarpanla ödenir
  readonly multiplier: number
  /// FS sırasında 3+ scatter → ek dönüş
  readonly retriggerAward: number
}

export interface GameConfig {
  readonly name: string
  /// Makara sayısı (strips.length ile aynı olmalı)
  readonly reelCount: number
  /// Satır sayısı (her makarada aynı)
  readonly rows: number
  /// `true` → kazançlar sağdan da okunur (both-ways slot)
  readonly bothWays: boolean
  /// Her makaranın sabit şeridi; spin = rastgele başlangıç + pencere
  readonly strips: readonly (readonly SymbolId[])[]
  /// Kazanç çizgileri: lines[i][reel] = o makaradaki satır indeksi
  readonly lines: readonly (readonly number[])[]
  readonly paytable: Readonly<Partial<Record<SymbolId, PayRow>>>
  readonly scatter: ScatterRule
  readonly wild: SymbolId
  readonly link: LinkConfig
  readonly freeSpins: FreeSpinConfig
}

export type Direction = 'ltr' | 'rtl'

export interface LineWin {
  /// lines dizisindeki indeks (0 tabanlı)
  readonly line: number
  readonly direction: Direction
  readonly symbol: SymbolId
  readonly count: number
  readonly multiplier: number
  /// lineBet üzerinden kazanılan tutar (minor birim, tamsayı)
  readonly win: number
}

export interface ScatterWin {
  readonly count: number
  readonly multiplier: number
  /// totalBet üzerinden kazanılan tutar (minor birim, tamsayı)
  readonly win: number
}

/// Tek bir spinin grid sonucu — istemci bunu SADECE oynatır, hesaplamaz.
export interface SpinResult {
  /// columns[reel][row] — render için grid dizilimi
  readonly columns: readonly (readonly SymbolId[])[]
  readonly lineWins: readonly LineWin[]
  readonly scatterWin: ScatterWin | null
  /// lineWins + scatterWin toplamı (paranın aldığı miktar)
  readonly totalWin: number
}

/// Link bonusunda tek bir sembolün yeri ve değeri
export interface LinkCell {
  readonly reel: number
  readonly row: number
  /// Bet çarpanı (0.5, 1, 2 … veya jackpot çarpanı)
  readonly value: number
  /// Jackpot kademesi ise sabit ödemeyi `value` üzerinden yapar
  readonly tier: JackpotTier | null
}

/// Bonusun tek adım — render bu listeyi sırayla oynatır
export interface LinkStep {
  /// Bu adımda yerleştirilen semboller (steps[0] = tetikleyen semboller)
  readonly added: readonly LinkCell[]
  /// Bu adımdan sonra kalan hak
  readonly respinsLeft: number
}

export interface LinkBonus {
  readonly triggerCount: number
  readonly steps: readonly LinkStep[]
  /// Turun sonundaki tüm semboller
  readonly cells: readonly LinkCell[]
  readonly jackpots: readonly JackpotTier[]
  /// Toplam kazanç (minor birim)
  readonly totalWin: number
  /// 15 hücre tamamı doldu mu
  readonly full: boolean
}

export interface FreeSpin {
  readonly index: number
  readonly result: SpinResult
  /// Çarpılmış kazanç (result.totalWin × freeSpins.multiplier)
  readonly win: number
}

export interface FreeSpinGame {
  readonly awardScatters: number
  readonly spins: readonly FreeSpin[]
  readonly totalWin: number
  readonly retriggers: number
}

/// Tek turun TAM sonucu (sunucu bunu üretir + kaydeder)
export interface SpinRound {
  readonly bet: number
  readonly base: SpinResult
  /// 6+ link sembolü varsa
  readonly link: LinkBonus | null
  /// 3+ scatter varsa (FS içindeki scatter'lar ayrıca retrigger sayar)
  readonly freeSpins: FreeSpinGame | null
  /// base + link + freeSpins
  readonly totalWin: number
}
