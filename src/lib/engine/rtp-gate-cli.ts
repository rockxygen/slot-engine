/// CLI: CI RTP KAPISI — `npm run gate [spins] [seed]`
///
/// Sertifikasyon/regresyon kapısı: kalibre edilmiş bantların DIŞINA
/// ÇIKAN her yapı değişikliği (paytable, ağırlık, çarpan, bonus
/// kuralı) exit1 ile CI'ı düşürür.
///
/// determinizm: sabit (spins, seed) → sabit sonuç. Varsayılan
/// (2.000.000, "rtp-gate-1") için sonuç TEKRARLANABİLİR bir sabittir;
/// seed/spins değiştirilirse bantlar yeniden gözden geçirilmelidir
/// (docs/CALIBRATION.md — değişiklik kontrolü bu kapıdan geçer).
import { CLOVER_LINK_BELLS as config } from './config'
import { formatStats, simulate } from './simulate'

const spins = Number(process.argv[2] ?? 2_000_000)
const seed = process.argv[3] ?? 'rtp-gate-1'
/// Her bet eşdeğerdir (lineer ölçeklemesi property testiyle kanıtlandı)
const bet = 100

interface Check {
  readonly name: string
  readonly got: number
  readonly lo: number
  readonly hi: number
  readonly fmt: (n: number) => string
}

const pct = (n: number) => `${n.toFixed(3)}%`
const x = (n: number) => `${n.toFixed(2)}×`

const stats = simulate(config, { spins, seed, bet })

const checks: Check[] = [
  // ── RTP bantları (Faz 10 kalibrasyonu: docs/CALIBRATION.md — Tur 11)
  //    + çan respin bonusu bileşeni (5+ çan, 15 dolum ×3)
  { name: 'TOPLAM RTP', got: stats.rtp * 100, lo: 95.4, hi: 96.6, fmt: pct },
  { name: 'base RTP', got: stats.baseRtp * 100, lo: 57.5, hi: 62.0, fmt: pct },
  { name: 'jackpot RTP', got: stats.jackpotRtp * 100, lo: 0.15, hi: 0.75, fmt: pct },
  // link: Faz 10'da bütçe çan bonusuyla paylaşıldı (jackpotChance %3→%2)
  { name: 'link RTP', got: stats.linkRtp * 100, lo: 10.0, hi: 13.0, fmt: pct },
  { name: 'çan RTP', got: stats.bellRtp * 100, lo: 1.1, hi: 2.4, fmt: pct },
  { name: 'freespins RTP', got: stats.freeSpinsRtp * 100, lo: 22.0, hi: 25.5, fmt: pct },
  // ── Oyun davranışı
  { name: 'hit rate', got: stats.hitRate * 100, lo: 45.0, hi: 49.0, fmt: pct },
  {
    name: 'link tetik (1/N)',
    got: stats.linkTriggerEvery ?? Infinity,
    lo: 280,
    hi: 430,
    fmt: (n) => `1/${n.toFixed(0)}`,
  },
  // çan: nadir-ama-büyük ikinci bonus (şerit ağırlığı 2 → ~1/4000)
  {
    name: 'çan tetik (1/N)',
    got: stats.bellTriggerEvery ?? Infinity,
    lo: 2000,
    hi: 8000,
    fmt: (n) => `1/${n.toFixed(0)}`,
  },
  {
    name: 'fs tetik (1/N)',
    got: stats.freeSpinTriggerEvery ?? Infinity,
    lo: 115,
    hi: 175,
    fmt: (n) => `1/${n.toFixed(0)}`,
  },
  // ── Uç değer / volatilite gözcüsü (Faz 10: çan full ×3 + grand çan
  //    ucu ~1680× çıkarır — bant Faz 10'a göre yeniden kilitlendi)
  { name: 'max win', got: stats.maxWinX, lo: 500, hi: 2000, fmt: x },
  { name: 'volatilite σ', got: stats.stdevX, lo: 4.0, hi: 7.5, fmt: x },
]

/// Yapısal kontrol: bileşenler toplamı RTP'ye EŞİT (aynı paradır)
const sumDelta = Math.abs(
  stats.rtp -
    (stats.baseRtp +
      stats.jackpotRtp +
      stats.linkRtp +
      stats.bellRtp +
      stats.freeSpinsRtp),
)
const sumOk = sumDelta < 1e-9

const rows = checks.map((c) => {
  const ok = c.got >= c.lo && c.got <= c.hi
  return {
    ok,
    line: `${ok ? '✓' : '✗'} ${c.name.padEnd(16)} ${c.fmt(c.got).padStart(10)}   bant [${c.fmt(c.lo)}, ${c.fmt(c.hi)}]`,
  }
})
rows.push({
  ok: sumOk,
  line: `${sumOk ? '✓' : '✗'} ${'bileşen toplamı'.padEnd(16)} Δ=${sumDelta.toExponential(1).padStart(10)}   bant [0, 1e-9)`,
})

console.log(
  [
    `RTP KAPISI — ${spins.toLocaleString('tr-TR')} spin, seed="${seed}", bet=${bet}`,
    ...rows.map((r) => r.line),
  ].join('\n'),
)

const failed = rows.filter((r) => !r.ok)
if (failed.length > 0) {
  console.log('\n✗ KAPI KAPANDI — detaylı simülasyon raporu:\n')
  console.log(formatStats(stats))
  process.exit(1)
}
console.log('\n✓ RTP KAPISI AÇIK — tüm bantlar içinde.')
