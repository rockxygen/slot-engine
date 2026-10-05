import { playFreeSpins, playLinkBonus } from './bonus'
import { drawSpinJackpot } from './jackpot'
import type { Rng } from './rng'
import { spin } from './spin'
import type { GameConfig, SpinRound } from './types'

/**
 * Tek turun tamamı — motorun sunucu tarafı GİRİŞ KAPISI.
 *
 * Akış:
 *   1. base spin (grid + çizgi/scatter kazancı)
 *   2. jackpot düşüşü (her normal spinde şans; RNG buradan yer)
 *   3. 6+ link sembolü → Link respin bonusu (RNG buradan yer)
 *   4. 3+ scatter → Free spins serisi (RNG buradan yer)
 *
 * Sıra SABITTIR ve kayda girer: aynı (config, seed, bet) → aynı tur.
 * Sunucu `SpinRound`'u üretir, seed zincirine yazar, client'a gönderir;
 * client yalnızca `base.columns`, `jackpot`, `link.steps`,
 * `freeSpins.spins` listelerini OYNATIR — hiçbir matematik client'ta değildir.
 *
 * Not (v1 kapsamı): Link bonusu yalnızca ana oyundan tetiklenir;
 * FS içindeki link sembolleri yalnızca scatter sayılır. Jackpot
 * düşüşü de YALNIZCA normal spine aittir (FS'de çizilmez).
 */
export function playRound(config: GameConfig, rng: Rng, bet: number): SpinRound {
  const base = spin(config, rng, bet)

  // 2) Jackpot düşüşü — şans tutmasa bile 1 adım harcanır (determinizm)
  const jackpot = drawSpinJackpot(rng, config.jackpot, bet)

  // 3) Link bonusu
  let link = null
  const trigger: { reel: number; row: number }[] = []
  base.columns.forEach((column, reel) => {
    column.forEach((symbol, row) => {
      if (symbol === config.link.symbol) trigger.push({ reel, row })
    })
  })
  if (trigger.length >= config.link.triggerCount) {
    link = playLinkBonus(config, rng, bet, trigger)
  }

  // 4) Free spins
  const scatters = base.scatterWin?.count ?? 0
  const minScatter = Math.min(...Object.keys(config.freeSpins.award).map(Number))
  const freeSpins =
    scatters >= minScatter ? playFreeSpins(config, rng, bet, scatters) : null

  const totalWin =
    base.totalWin +
    (jackpot?.win ?? 0) +
    (link?.totalWin ?? 0) +
    (freeSpins?.totalWin ?? 0)

  return { bet, base, jackpot, link, freeSpins, totalWin }
}
