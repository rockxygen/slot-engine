import { evaluateGrid } from './evaluate'
import { spinReels } from './reels'
import type { Rng } from './rng'
import type { GameConfig, SpinResult } from './types'

/**
 * Tek spin — motorun tek giriş kapısı.
 *
 * Determinizm sözleşmesi: aynı (config, seed/state, bet) → aynı sonuç.
 * Sunucu bu fonksiyonu çalıştırıp SONUCU kaydeder; istemci sonucu
 * yalnızca oynatır (animasyon), ASLA kendi matematiğini yapmaz.
 */
export function spin(config: GameConfig, rng: Rng, bet: number): SpinResult {
  const columns = spinReels(config, rng)
  const { lineWins, scatterWin, totalWin } = evaluateGrid(config, columns, bet)
  return { columns, lineWins, scatterWin, totalWin }
}
