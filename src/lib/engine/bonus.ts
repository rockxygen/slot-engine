import { pickJackpotTier } from './jackpot'
import { spin } from './spin'
import type { Rng } from './rng'
import type {
  FreeSpinGame,
  FreeSpin,
  GameConfig,
  JackpotTier,
  LinkBonus,
  LinkCell,
} from './types'

/// `table` = {değer: ağırlık}; ağırlıklar arasından deterministik seçim
function pickWeighted(rng: Rng, table: Readonly<Record<number, number>>): number {
  const entries = Object.entries(table).map(
    ([k, w]) => [Number(k), w] as const,
  )
  const total = entries.reduce((s, [, w]) => s + w, 0)
  if (total <= 0) throw new Error('pickWeighted: ağırlık toplamı pozitif olmalı')
  let roll = rng.next() * total
  for (const [value, weight] of entries) {
    roll -= weight
    if (roll < 0) return value
  }
  return entries[entries.length - 1][0]
}

/// Yerleştirilecek tek bir link sembolünün değerini üretir
function drawLinkCell(
  config: GameConfig,
  rng: Rng,
  reel: number,
  row: number,
): LinkCell {
  const link = config.link
  if (rng.next() < link.jackpotChance) {
    // Kademe tablosu ortak: spin düşüşüyle aynı `jackpot.tiers`
    const tier = pickJackpotTier(rng, config.jackpot.tiers)
    return { reel, row, value: config.jackpot.tiers[tier].multiplier, tier }
  }
  return { reel, row, value: pickWeighted(rng, link.values), tier: null }
}

/**
 * Link respin bonusu — Hold & Win tarzı.
 *
 * Kurallar:
 *  - `trigger` = tetikleyen sembollerin yerleri (6+), değerleri burada çizilir.
 *  - `respinCount` hak ile başlanır; adımda ≥1 sembol gelirse hak yeniden
 *    `respinCount`'a döner, hiç gelmezse 1 azalır.
 *  - Tüm hücreler dolarsa (`full`) veya hak biterse tur kapanır.
 *  - Kazanç = Σ(sembol değeri × bet), jackpot kademeleri kendi çarpanıyla.
 *
 * DETERMİNİZM: aynı (config, rng gidişatı, trigger) → aynı tur.
 * Sunucu tüm adımları üretir; istemci `steps`'i sırayla oynatır.
 */
export function playLinkBonus(
  config: GameConfig,
  rng: Rng,
  bet: number,
  trigger: readonly { reel: number; row: number }[],
): LinkBonus {
  const link = config.link
  if (trigger.length < link.triggerCount) {
    throw new Error(
      `Link bonusu tetiklenemedi: ${trigger.length} < ${link.triggerCount}`,
    )
  }

  const occupied = new Set<string>()
  const mark = (c: { reel: number; row: number }) => `${c.reel}:${c.row}`

  const cells: LinkCell[] = trigger.map((p) => {
    const cell = drawLinkCell(config, rng, p.reel, p.row)
    occupied.add(mark(cell))
    return cell
  })

  const steps = [{ added: [...cells], respinsLeft: link.respinCount }]
  let respinsLeft = link.respinCount

  while (respinsLeft > 0 && occupied.size < link.cellCount) {
    const k = pickWeighted(rng, link.stepCounts)
    const empty: { reel: number; row: number }[] = []
    for (let reel = 0; reel < config.reelCount; reel++) {
      for (let row = 0; row < config.rows; row++) {
        if (!occupied.has(`${reel}:${row}`)) empty.push({ reel, row })
      }
    }

    const added: LinkCell[] = []
    const take = Math.min(k, empty.length)
    for (let i = 0; i < take; i++) {
      // boş hücrelerden rastgele, tekrarsız seçim
      const idx = rng.nextInt(empty.length)
      const pos = empty[idx]
      empty[idx] = empty[empty.length - 1]
      empty.pop()
      const cell = drawLinkCell(config, rng, pos.reel, pos.row)
      occupied.add(mark(cell))
      added.push(cell)
      cells.push(cell)
    }

    respinsLeft = added.length > 0 ? link.respinCount : respinsLeft - 1
    steps.push({ added, respinsLeft })
  }

  let totalWin = 0
  const jackpots: JackpotTier[] = []
  for (const cell of cells) {
    totalWin += Math.round(cell.value * bet)
    if (cell.tier) jackpots.push(cell.tier)
  }

  return {
    triggerCount: trigger.length,
    steps,
    cells,
    jackpots,
    totalWin,
    full: occupied.size >= link.cellCount,
  }
}

const MAX_FS_SPINS = 50 // toplam retrigger guard'ı (sonsuz döngü imkânsız)

/**
 * Free spins serisi — scatter tetikler, FS içi scatter retrigger ekler.
 * Her FS `freeSpins.multiplier` katıyla ödenir.
 *
 * DETERMİNİZM: aynı rng gidişatı → aynı seri.
 */
export function playFreeSpins(
  config: GameConfig,
  rng: Rng,
  bet: number,
  awardScatters: number,
): FreeSpinGame {
  const fs = config.freeSpins
  const awardTable = fs.award
  const maxAwardKey = Math.max(...Object.keys(awardTable).map(Number))
  // 5+ scatter normalde en yüksek anahtara düşer
  let remaining = awardTable[Math.min(awardScatters, maxAwardKey)] ?? 0
  if (remaining <= 0) {
    throw new Error(`Free spin ödülü tanımsız: scatter=${awardScatters}`)
  }

  const spins: FreeSpin[] = []
  let totalWin = 0
  let retriggers = 0
  let index = 0

  while (remaining > 0 && index < MAX_FS_SPINS) {
    const result = spin(config, rng, bet)
    const win = result.totalWin * fs.multiplier
    totalWin += win
    spins.push({ index, result, win })

    const scatters = result.scatterWin?.count ?? 0
    if (scatters >= Math.min(...Object.keys(awardTable).map(Number))) {
      remaining += fs.retriggerAward
      retriggers++
    }
    remaining--
    index++
  }

  return { awardScatters, spins, totalWin, retriggers }
}
