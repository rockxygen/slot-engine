/// Semboller oyunun VERİSİDİR; motor kodu sembol adlarına göre dallanmaz.
/// Yeni sembol eklemek = config'e eklemek, kodu değiştirmek değil.
export type SymbolId =
  | 'wild'
  | 'scatter'
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

/// Tek bir spinin tam sonucu — istemci bunu SADECE oynatır, hesaplamaz.
export interface SpinResult {
  /// columns[reel][row] — render için grid dizilimi
  readonly columns: readonly (readonly SymbolId[])[]
  readonly lineWins: readonly LineWin[]
  readonly scatterWin: ScatterWin | null
  /// lineWins + scatterWin toplamı (paranın aldığı miktar)
  readonly totalWin: number
}
