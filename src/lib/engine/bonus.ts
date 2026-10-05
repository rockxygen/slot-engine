import { pickJackpotTier } from './jackpot'
import { spin } from './spin'
import type { Rng } from './rng'
import type {
  FreeSpinGame,
  FreeSpin,
  GameConfig,
  JackpotTier,
  JackpotTierTable,
  RespinBonus,
  RespinCell,
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

/// Respin bonusunun config'ten türeyen çalıştırma kuralları
/// (link ve çan aynı çekirdeği paylaşır — sadece veri farklıdır)
interface RespinRules {
  readonly triggerCount: number
  readonly respinCount: number
  readonly cellCount: number
  readonly values: Readonly<Record<number, number>>
  readonly jackpotChance: number
  readonly stepCounts: Readonly<Record<number, number>>
  /// `full` olurken totalWin'e uygulanan çarpan (link: 1, çan: 3)
  readonly fullMultiplier: number
  /// Faz 9 öncesi config'te `link.jackpots` altındaki eski kademe tablosu
  /// (top-level `jackpot` yokken bununla ödenir — replay birebirliği)
  readonly jackpots?: JackpotTierTable
}

/// Yerleştirilecek tek bir respin sembolünün değerini üretir
function drawRespinCell(
  rules: RespinRules,
  tiers: JackpotTierTable,
  rng: Rng,
  reel: number,
  row: number,
): RespinCell {
  if (rng.next() < rules.jackpotChance) {
    // Kademe tablosu ortak: spin düşüşüyle aynı `jackpot.tiers`
    // (eski config'te `link.jackpots`) — `tier` AYNI tablodan geldi → defined
    const tier = pickJackpotTier(rng, tiers)
    return { reel, row, value: tiers[tier]!.multiplier, tier }
  }
  return { reel, row, value: pickWeighted(rng, rules.values), tier: null }
}

/**
 * Respin bonusu çekirdeği — Hold & Win tarzı (link 🪙 ve çan 🔔 ortak).
 *
 * Kurallar:
 *  - `trigger` = tetikleyen sembollerin yerleri, değerleri burada çizilir.
 *  - `respinCount` hak ile başlanır; adımda ≥1 sembol gelirse hak yeniden
 *    `respinCount`'a döner, hiç gelmezse 1 azalır.
 *  - Tüm hücreler dolarsa (`full`) veya hak biterse tur kapanır.
 *  - Kazanç = Σ(sembol değeri × bet), jackpot kademeleri kendi çarpanıyla.
 *  - `fullMultiplier > 1` ise (çan bonusu) toplam tam dolulukta
 *    Σ × fullMultiplier olarak ödenir (15 çan → 3 katı).
 *
 * DETERMİNİZM: aynı (rules, rng gidişatı, trigger) → aynı tur.
 * Sunucu tüm adımları üretir; istemci `steps`'i sırayla oynatır.
 */
function playRespins(
  config: GameConfig,
  rules: RespinRules,
  rng: Rng,
  bet: number,
  trigger: readonly { reel: number; row: number }[],
): RespinBonus {
  if (trigger.length < rules.triggerCount) {
    throw new Error(
      `Respin bonusu tetiklenemedi: ${trigger.length} < ${rules.triggerCount}`,
    )
  }
  // Kademe tablosu: güncel config'te tek kaynak `jackpot.tiers`.
  // Faz 9 öncesi snapshot'larda `jackpot` anahtarı YOKTUR ve tablo
  // `link.jackpots` altındaydı — eski turlar oynandıkları tabloyla
  // (aynı ağırlıklarla) birebir replay edilsin diye oradan okunur.
  const tiers = config.jackpot?.tiers ?? rules.jackpots
  if (!tiers) throw new Error('Respin bonusu: kademe tablosu bulunamadı')

  const occupied = new Set<string>()
  const mark = (c: { reel: number; row: number }) => `${c.reel}:${c.row}`

  const cells: RespinCell[] = trigger.map((p) => {
    const cell = drawRespinCell(rules, tiers, rng, p.reel, p.row)
    occupied.add(mark(cell))
    return cell
  })

  const steps = [{ added: [...cells], respinsLeft: rules.respinCount }]
  let respinsLeft = rules.respinCount

  while (respinsLeft > 0 && occupied.size < rules.cellCount) {
    const k = pickWeighted(rng, rules.stepCounts)
    const empty: { reel: number; row: number }[] = []
    for (let reel = 0; reel < config.reelCount; reel++) {
      for (let row = 0; row < config.rows; row++) {
        if (!occupied.has(`${reel}:${row}`)) empty.push({ reel, row })
      }
    }

    const added: RespinCell[] = []
    const take = Math.min(k, empty.length)
    for (let i = 0; i < take; i++) {
      // boş hücrelerden rastgele, tekrarsız seçim
      const idx = rng.nextInt(empty.length)
      const pos = empty[idx]
      empty[idx] = empty[empty.length - 1]
      empty.pop()
      const cell = drawRespinCell(rules, tiers, rng, pos.reel, pos.row)
      occupied.add(mark(cell))
      added.push(cell)
      cells.push(cell)
    }

    respinsLeft = added.length > 0 ? rules.respinCount : respinsLeft - 1
    steps.push({ added, respinsLeft })
  }

  let sum = 0
  const jackpots: JackpotTier[] = []
  for (const cell of cells) {
    sum += Math.round(cell.value * bet)
    if (cell.tier) jackpots.push(cell.tier)
  }
  const full = occupied.size >= rules.cellCount
  const totalWin = full ? sum * rules.fullMultiplier : sum

  return {
    triggerCount: trigger.length,
    steps,
    cells,
    jackpots,
    totalWin,
    full,
  }
}

/**
 * Link respin bonusu (🪙) — 6+ sembol tetikler. Kurallar için
 * `playRespins`'e bakın; link'te tam doluluk ekstra ödeme yapmaz
 * (fullMultiplier = 1).
 */
export function playLinkBonus(
  config: GameConfig,
  rng: Rng,
  bet: number,
  trigger: readonly { reel: number; row: number }[],
): RespinBonus {
  const link = config.link
  return playRespins(
    config,
    { ...link, fullMultiplier: 1 },
    rng,
    bet,
    trigger,
  )
}

/**
 * Çan respin bonusu (🔔 · Faz 10) — 5+ çan tetikler, haklar yeni çanda
 * 3'e sıfırlanır, 3 boş adımda toplanan tutar ödenir. Çan değerleri bet
 * oranlıdır; %3 şansla jackpot kademeli çan (bet × kademe çarpanı) iner.
 * 15 çanın hepsi toplanırsa ödül `fullMultiplier` (×3) katı ödenir.
 */
export function playBellBonus(
  config: GameConfig,
  rng: Rng,
  bet: number,
  trigger: readonly { reel: number; row: number }[],
): RespinBonus {
  return playRespins(config, config.bell, rng, bet, trigger)
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
