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

/// Jackpot kademeleri — sabit bahis katlarıyla öder (orantılı başlangıç:
/// Mini→Grand artan çarpan, ağırlık tersine düşer).
/// Üç yerde kullanılır: normal spine düşüş (jackpot.spinChance), link
/// bonusu hücreleri (link.jackpotChance) ve çan bonusu hücreleri
/// (bell.jackpotChance) — hepsi `jackpot.tiers` tek kaynaktır.
export type JackpotTier = 'mini' | 'minor' | 'maxi' | 'major' | 'grand'

/// Kademe sunum sırası (prize bar, sim raporu, testler aynı sırayı paylaşır)
export const JACKPOT_TIERS: readonly JackpotTier[] = [
  'mini',
  'minor',
  'maxi',
  'major',
  'grand',
]

export interface JackpotRule {
  /// Kademe ağırlığı (toplam jackpot şansının dağılımı)
  readonly weight: number
  /// Bet çarpanı (mini 10×, grand 500× gibi)
  readonly multiplier: number
}

export interface JackpotConfig {
  /// Normal spin'de jackpot düşme olasılığı [0,1) — ödül bahis orantılıdır
  readonly spinChance: number
  /// Kademe tablosu: ağırlık + bet çarpanı (tek kaynak — hem spin hem link)
  readonly tiers: Readonly<Record<JackpotTier, JackpotRule>>
}

/// Kademe tablosunun **eski (Faz 9 öncesi)** biçimi: `maxi` kademesi henüz
/// eklenmemişti → partial. `config.jackpot.tiers` (tam) bu tiptir.
export type JackpotTierTable = Readonly<Partial<Record<JackpotTier, JackpotRule>>>

/// Respin bonusunun ortak kuralları — Link (🪙) ve Çan (🔔) AYNI çekirdeği
/// paylaşır; farklar config'tedir (tetik sembolü, değerler, tam çarpan).
export interface RespinConfig {
  readonly symbol: SymbolId
  /// Bu kadar + sembol griddeyse bonus tetiklenir
  readonly triggerCount: number
  /// Her boş adımda sıfırlanan hak (başlangıç dahil)
  readonly respinCount: number
  /// Toplam hücre (reelCount × rows); hepsi dolarsa `full` olur
  readonly cellCount: number
  /// Normal sembol değeri → ağırlık (değer = bet çarpanı)
  readonly values: Readonly<Record<number, number>>
  /// Yerleşen bir sembolün jackpot KADEMESİ olma olasılığı [0,1)
  /// (kademe tablosu `GameConfig.jackpot.tiers` — tek kaynak)
  readonly jackpotChance: number
  /// Adımda eklenen sembol sayısı → ağırlık (0 = boş adım → hak azalır)
  readonly stepCounts: Readonly<Record<number, number>>
  /// **Yalnızca Faz 9 öncesi snapshot'larda**: kademe tablosu eskiden
  /// link'in ALTINDAYDI (`link.jackpots`, top-level `jackpot` anahtarı
  /// henüz yoktu). Replay birebir sürsün diye eski yerinden okunur.
  readonly jackpots?: JackpotTierTable
}

export type LinkConfig = RespinConfig

/// Çan respin bonusu (Faz 10): 5+ çan → 3 hak, yeni çan hakları sıfırlar,
/// 3 boş adımda toplanan tutar ödenir. 15 hücre dolarsa toplam
/// `fullMultiplier` katı ödenir (15 çan → 3 katı).
export interface BellConfig extends RespinConfig {
  readonly fullMultiplier: number
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
  /// Link respin bonusu (6+ 🪙) — Faz 2'den beri
  readonly link: LinkConfig
  /// Çan respin bonusu (5+ 🔔) — Faz 10. Eski snapshot'larda ANAHTAR YOKTUR:
  /// motor `bell` yokken RNG adımı harcamadan atlar (tarihsel akış korunur).
  readonly bell: BellConfig
  /// Jackpot: her normal spinde şanslı düşüş + link/çan hücreleri ortak tablo
  readonly jackpot: JackpotConfig
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

/// Respin bonusunda tek bir sembolün yeri ve değeri (link 🪙 ve çan 🔔 ortak)
export interface RespinCell {
  readonly reel: number
  readonly row: number
  /// Bet çarpanı (0.5, 1, 2 … veya jackpot çarpanı)
  readonly value: number
  /// Jackpot kademesi ise sabit ödemeyi `value` üzerinden yapar
  readonly tier: JackpotTier | null
}

/// Bonusun tek adım — render bu listeyi sırayla oynatır
export interface RespinStep {
  /// Bu adımda yerleştirilen semboller (steps[0] = tetikleyen semboller)
  readonly added: readonly RespinCell[]
  /// Bu adımdan sonra kalan hak
  readonly respinsLeft: number
}

export interface RespinBonus {
  readonly triggerCount: number
  readonly steps: readonly RespinStep[]
  /// Turun sonundaki tüm semboller
  readonly cells: readonly RespinCell[]
  readonly jackpots: readonly JackpotTier[]
  /// Toplam kazanç (minor birim) — `full` ise × fullMultiplier uygulanmış hâli
  readonly totalWin: number
  /// 15 hücre tamamı doldu mu
  readonly full: boolean
}

/// Geriye dönük adlar (mevcut import'lar + bonusa özel okunabilirlik)
export type LinkCell = RespinCell
export type LinkStep = RespinStep
export type LinkBonus = RespinBonus
export type BellBonus = RespinBonus

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

/// Normal spin içinde doğrudan düşen jackpot (tur RNG akışında
/// base spin'den sonra, link bonusundan önce çizilir)
export interface JackpotHit {
  readonly tier: JackpotTier
  /// bet × tier.multiplier (minor birim, her zaman tamsayı)
  readonly win: number
}

/// Tek turun TAM sonucu (sunucu bunu üretir + kaydeder)
export interface SpinRound {
  readonly bet: number
  readonly base: SpinResult
  /// Normal spine şansla düşen jackpot (yoksa null)
  readonly jackpot: JackpotHit | null
  /// 6+ link sembolü varsa
  readonly link: RespinBonus | null
  /// 5+ çan sembolü varsa (Faz 10)
  readonly bell: RespinBonus | null
  /// 3+ scatter varsa (FS içindeki scatter'lar ayrıca retrigger sayar)
  readonly freeSpins: FreeSpinGame | null
  /// base + jackpot + link + bell + freeSpins
  readonly totalWin: number
}
