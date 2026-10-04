import { createRng } from './rng'
import { spin } from './spin'
import type { GameConfig, SymbolId } from './types'

export interface SimOptions {
  readonly spins: number
  readonly seed: string
  /// Topplam bahis (minor birim, çizgi sayısına tam bölünmeli)
  readonly bet: number
}

export interface SimStats {
  readonly spins: number
  readonly seed: string
  readonly bet: number
  readonly totalBet: number
  readonly totalWin: number
  /// RTP = totalWin / totalBet (hedefe oturtulan ana metrik)
  readonly rtp: number
  /// Kazançlı spin oranı (hit frequency)
  readonly hitRate: number
  /// Kazançlı olmayan en uzun seri
  readonly maxLosingStreak: number
  /// Tek spinde en yüksek kazanç (bahis katı)
  readonly maxWinX: number
  /// Volatilite: spin başına kazancın standart sapması (bahis katı)
  readonly stdevX: number
  /// sembol → toplam kazanç (RTP kalibrasyonu için hangi sembolün
  /// ne kadar RTP taşıdığını gösterir)
  readonly winBySymbol: Readonly<Partial<Record<SymbolId, number>>>
}

/**
 * Monte Carlo RTP/volatilite simülasyonu.
 *
 * Motor matematiğini milyonlarca kez çalıştırıp ölçülen RTP'yi hedefe
 * yaklaştırır. Hesap tamsayıdır; döndürülen değerlerde yuvarlama yok.
 */
export function simulate(config: GameConfig, opts: SimOptions): SimStats {
  const { spins, seed, bet } = opts
  if (spins <= 0) throw new RangeError('spins > 0 olmalı')
  if (bet <= 0 || bet % config.lines.length !== 0) {
    throw new RangeError(`bet, çizgi sayısına (${config.lines.length}) tam bölünmeli`)
  }

  const rng = createRng(seed)
  let totalWin = 0
  let hitSpins = 0
  let losingStreak = 0
  let maxLosingStreak = 0
  let maxWinX = 0
  let sumX = 0
  let sumXX = 0
  const winBySymbol: Partial<Record<SymbolId, number>> = {}

  for (let i = 0; i < spins; i++) {
    const result = spin(config, rng, bet)
    const win = result.totalWin

    totalWin += win
    const x = win / bet
    sumX += x
    sumXX += x * x

    if (win > 0) {
      hitSpins++
      losingStreak = 0
      if (x > maxWinX) maxWinX = x
      for (const w of result.lineWins) {
        winBySymbol[w.symbol] = (winBySymbol[w.symbol] ?? 0) + w.win
      }
      if (result.scatterWin) {
        const s = config.scatter.symbol
        winBySymbol[s] = (winBySymbol[s] ?? 0) + result.scatterWin.win
      }
    } else {
      losingStreak++
      if (losingStreak > maxLosingStreak) maxLosingStreak = losingStreak
    }
  }

  const totalBet = spins * bet
  const meanX = sumX / spins
  // Population stdev (n, n-1 değil — simülasyon tam örneklem)
  const varianceX = Math.max(0, sumXX / spins - meanX * meanX)

  return {
    spins,
    seed,
    bet,
    totalBet,
    totalWin,
    rtp: totalWin / totalBet,
    hitRate: hitSpins / spins,
    maxLosingStreak,
    maxWinX,
    stdevX: Math.sqrt(varianceX),
    winBySymbol,
  }
}

/// İnsan-okur rapor
export function formatStats(stats: SimStats): string {
  const pct = (n: number) => `${(n * 100).toFixed(3)}%`
  const money = (n: number) => (n / 100).toLocaleString('tr-TR', { minimumFractionDigits: 2 })

  const bySymbol = Object.entries(stats.winBySymbol)
    .sort((a, b) => b[1] - a[1]!)
    .map(([s, v]) => `  ${s.padEnd(11)} ${pct(v! / stats.totalBet).padStart(8)}  (${money(v!)} ₺)`)

  return [
    `Oyun     : ${'clover-link-bells'}`,
    `Spin     : ${stats.spins.toLocaleString('tr-TR')}  seed="${stats.seed}"  bet=${money(stats.bet)} ₺`,
    `RTP      : ${pct(stats.rtp)}`,
    `Hit rate : ${pct(stats.hitRate)}`,
    `Max win  : ${stats.maxWinX.toFixed(1)}× bahis`,
    `Volatilite (σ): ${stats.stdevX.toFixed(2)}× bahis`,
    `Uzun kayıpsız seri: ${stats.maxLosingStreak} spin`,
    `Toplam bahis : ${money(stats.totalBet)} ₺`,
    `Toplam kazanç: ${money(stats.totalWin)} ₺`,
    `Kazanç dağılımı (RTP payı):`,
    ...bySymbol,
  ].join('\n')
}
