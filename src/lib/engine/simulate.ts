import { createRng } from './rng'
import { playRound } from './round'
import type { GameConfig, JackpotTier, SymbolId } from './types'

export interface SimOptions {
  readonly spins: number
  readonly seed: string
  /// Toplam bahis (minor birim, çizgi sayısına tam bölünmeli)
  readonly bet: number
}

export interface SimStats {
  readonly spins: number
  readonly seed: string
  readonly bet: number
  readonly totalBet: number
  readonly totalWin: number
  /// TOPLAM RTP = (base + link + freeSpins) / totalBet — hedef metrik
  readonly rtp: number
  /// Katkı payları (aynı toplamı verirler, rtp = baseRtp+linkRtp+fsRtp)
  readonly baseRtp: number
  readonly linkRtp: number
  readonly freeSpinsRtp: number
  /// Kazançlı tur oranı
  readonly hitRate: number
  /// Kazançlı olmayan en uzun seri
  readonly maxLosingStreak: number
  /// Tek turda en yüksek kazanç (bahis katı)
  readonly maxWinX: number
  /// Volatilite: tur başına kazancın standart sapması (bahis katı)
  readonly stdevX: number
  /// Tetikleme frekansları: 1/N turda bir
  readonly linkTriggerEvery: number | null
  readonly freeSpinTriggerEvery: number | null
  readonly freeSpinRetriggers: number
  /// Link bonusu başına ortalama dolan hücre
  readonly linkAvgCells: number
  readonly jackpotsWon: Readonly<Record<JackpotTier, number>>
  /// base satır kazançlarının sembol dağılımı (paytable kalibrasyonu için)
  readonly winBySymbol: Readonly<Partial<Record<SymbolId, number>>>
}

/**
 * Monte Carlo RTP/volatilite simülasyonu — TÜM turu (base + link + FS)
 * çalıştırır ve RTP'yi katkısına göre ayrıştırır.
 */
export function simulate(config: GameConfig, opts: SimOptions): SimStats {
  const { spins, seed, bet } = opts
  if (spins <= 0) throw new RangeError('spins > 0 olmalı')
  if (bet <= 0 || bet % config.lines.length !== 0) {
    throw new RangeError(`bet, çizgi sayısına (${config.lines.length}) tam bölünmeli`)
  }

  const rng = createRng(seed)
  let baseWin = 0
  let linkWin = 0
  let fsWin = 0
  let hitSpins = 0
  let losingStreak = 0
  let maxLosingStreak = 0
  let maxWinX = 0
  let sumX = 0
  let sumXX = 0
  let linkTriggers = 0
  let fsTriggers = 0
  let linkCells = 0
  let retriggers = 0
  const jackpotsWon: Record<JackpotTier, number> = { mini: 0, minor: 0, major: 0, grand: 0 }
  const winBySymbol: Partial<Record<SymbolId, number>> = {}

  for (let i = 0; i < spins; i++) {
    const round = playRound(config, rng, bet)

    baseWin += round.base.totalWin
    if (round.link) {
      linkWin += round.link.totalWin
      linkTriggers++
      linkCells += round.link.cells.length
      for (const tier of round.link.jackpots) jackpotsWon[tier]++
    }
    if (round.freeSpins) {
      fsWin += round.freeSpins.totalWin
      fsTriggers++
      retriggers += round.freeSpins.retriggers
    }

    const win = round.totalWin
    const x = win / bet
    sumX += x
    sumXX += x * x

    if (win > 0) {
      hitSpins++
      losingStreak = 0
      if (x > maxWinX) maxWinX = x
      for (const w of round.base.lineWins) {
        winBySymbol[w.symbol] = (winBySymbol[w.symbol] ?? 0) + w.win
      }
      if (round.base.scatterWin) {
        const s = config.scatter.symbol
        winBySymbol[s] = (winBySymbol[s] ?? 0) + round.base.scatterWin.win
      }
    } else {
      losingStreak++
      if (losingStreak > maxLosingStreak) maxLosingStreak = losingStreak
    }
  }

  const totalBet = spins * bet
  const totalWin = baseWin + linkWin + fsWin
  const meanX = sumX / spins
  const varianceX = Math.max(0, sumXX / spins - meanX * meanX)

  return {
    spins,
    seed,
    bet,
    totalBet,
    totalWin,
    rtp: totalWin / totalBet,
    baseRtp: baseWin / totalBet,
    linkRtp: linkWin / totalBet,
    freeSpinsRtp: fsWin / totalBet,
    hitRate: hitSpins / spins,
    maxLosingStreak,
    maxWinX,
    stdevX: Math.sqrt(varianceX),
    linkTriggerEvery: linkTriggers > 0 ? spins / linkTriggers : null,
    freeSpinTriggerEvery: fsTriggers > 0 ? spins / fsTriggers : null,
    freeSpinRetriggers: retriggers,
    linkAvgCells: linkTriggers > 0 ? linkCells / linkTriggers : 0,
    jackpotsWon,
    winBySymbol,
  }
}

/// İnsan-okur rapor
export function formatStats(stats: SimStats): string {
  const pct = (n: number) => `${(n * 100).toFixed(3)}%`
  const money = (n: number) => (n / 100).toLocaleString('tr-TR', { minimumFractionDigits: 2 })
  const every = (n: number | null) => (n === null ? 'hiç' : `1/${n.toFixed(0)}`)

  const bySymbol = Object.entries(stats.winBySymbol)
    .sort((a, b) => b[1] - a[1]!)
    .map(([s, v]) => `  ${s.padEnd(11)} ${pct(v! / stats.totalBet).padStart(8)}`)

  const jackpots = Object.entries(stats.jackpotsWon)
    .filter(([, n]) => n > 0)
    .map(([t, n]) => `${t}=${n}`)
    .join('  ') || 'yok'

  return [
    `Oyun        : clover-link-bells`,
    `Spin        : ${stats.spins.toLocaleString('tr-TR')}  seed="${stats.seed}"  bet=${money(stats.bet)} ₺`,
    `TOPLAM RTP  : ${pct(stats.rtp)}   (hedef %96.00)`,
    `  base game : ${pct(stats.baseRtp)}`,
    `  link      : ${pct(stats.linkRtp)}   tetik ${every(stats.linkTriggerEvery)}  ort. ${stats.linkAvgCells.toFixed(1)} hücre`,
    `  freespins : ${pct(stats.freeSpinsRtp)}   tetik ${every(stats.freeSpinTriggerEvery)}  retrigger ${stats.freeSpinRetriggers}`,
    `Hit rate    : ${pct(stats.hitRate)}`,
    `Max win     : ${stats.maxWinX.toFixed(1)}× bahis`,
    `Volatilite  : σ = ${stats.stdevX.toFixed(2)}× bahis`,
    `Kayıpsız seri: ${stats.maxLosingStreak} tur`,
    `Jackpotlar  : ${jackpots}`,
    `Toplam bahis : ${money(stats.totalBet)} ₺`,
    `Toplam kazanç: ${money(stats.totalWin)} ₺`,
    `Base RTP sembol payları:`,
    ...bySymbol,
  ].join('\n')
}
