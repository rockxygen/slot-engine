import type { Rng } from './rng'
import type {
  JackpotConfig,
  JackpotHit,
  JackpotRule,
  JackpotTier,
  JackpotTierTable,
} from './types'

/// `tiers` ağırlıkları arasından deterministik kademe seçimi.
/// Kullanım: normal spin düşüşü (drawSpinJackpot) ve Link bonusu
/// hücresi (bonus.ts) — tek ağırlık tablosu = tek gerçek.
/// (Tablo partial olabilir: Faz 9 öncesi `link.jackpots`'ta `maxi` yok.)
export function pickJackpotTier(
  rng: Rng,
  tiers: JackpotTierTable,
): JackpotTier {
  const entries = Object.entries(tiers) as [JackpotTier, JackpotRule][]
  const total = entries.reduce((s, [, rule]) => s + rule.weight, 0)
  if (total <= 0) throw new Error('pickJackpotTier: ağırlık toplamı pozitif olmalı')
  let roll = rng.next() * total
  for (const [tier, rule] of entries) {
    roll -= rule.weight
    if (roll < 0) return tier
  }
  return entries[entries.length - 1][0]
}

/**
 * Normal spin jackpot düşüşü — `playRound` base spin'den sonra, link
 * bonusundan önce ÇİZER (sıra sabittir → seed zinciri/replay dahil).
 *
 * Ödül orantılıdır: `bet × tier.multiplier` (tamsayı, lineer).
 * Şans tutmazsa 1 RNG adımı harcanır ve `null` döner — yine de
 * akış deterministiktir.
 *
 * **Geriye uyumluluk (Faz 9 öncesi denetim kayıtları)**: eski config
 * snapshot'larında `jackpot` anahtarı YOKTUR ve eski kod bu adımı hiç
 * çizmemişti. Bu durumda RNG'den HİÇ adım harcanmadan `null` döner —
 * eski turların base→link→FS akışı birebir aynı kalır (replay sözleşmesi).
 */
export function drawSpinJackpot(
  rng: Rng,
  config: JackpotConfig | null | undefined,
  bet: number,
): JackpotHit | null {
  if (!config) return null // Faz 9 öncesi snapshot: adım harcamadan geç
  if (rng.next() >= config.spinChance) return null
  const tier = pickJackpotTier(rng, config.tiers)
  return { tier, win: bet * config.tiers[tier].multiplier }
}
