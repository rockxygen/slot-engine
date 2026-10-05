import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { ALLOWED_BETS } from '@/lib/api-types'
import { CLOVER_LINK_BELLS as config } from './config'
import { evaluateGrid } from './evaluate'
import { SYMBOL_IDS, type SpinRound } from './types'
import { createRng, playRound } from './index'

/// Faz 5 — PROPERTY-BASED TESTLER (fast-check)
///
/// Amaç: tek tek örnek yerine "tüm girdi uzayını" zorlayan genel
/// iddialar. Bunlar sertifikasyon kanıtıdır: matematik DEĞİŞSE bile
/// değişmez sözleşmeler (determinizm, para tamsayısı, lineer bahis
/// ölçeklemesi, kompozisyon) kırılamaz.

const LINE_COUNT = config.lines.length

/// Çizgi sayısına TAM bölünen herhangi bir pozitif bet (motorun tek şartı)
const betArb = fc.integer({ min: 1, max: 100 }).map((k) => k * LINE_COUNT)

/// Serbest metin seed (xmur3 her girdiyi işler)
const seedArb = fc.string({ maxLength: 64 })

const round = (seed: string, bet: number): SpinRound =>
  playRound(config, createRng(seed), bet)

const money = (r: SpinRound): number[] => [
  r.totalWin,
  r.base.totalWin,
  r.jackpot?.win ?? 0,
  ...r.base.lineWins.map((w) => w.win),
  r.base.scatterWin?.win ?? 0,
  r.link?.totalWin ?? 0,
  r.freeSpins?.totalWin ?? 0,
  ...(r.freeSpins?.spins.map((s) => s.win) ?? []),
]

describe('property: determinizm', () => {
  it('aynı (seed, bet) → JSON olarak birebir aynı tur', () => {
    fc.assert(
      fc.property(seedArb, betArb, (seed, bet) => {
        const a = round(seed, bet)
        const b = round(seed, bet)
        expect(JSON.stringify(b)).toBe(JSON.stringify(a))
      }),
      { numRuns: 200 },
    )
  })

  it('round.bet her zaman istenen bahistir', () => {
    fc.assert(
      fc.property(seedArb, betArb, (seed, bet) => {
        expect(round(seed, bet).bet).toBe(bet)
      }),
      { numRuns: 100 },
    )
  })
})

describe('property: para sözleşmesi', () => {
  it('totalWin = base + jackpot + link + freeSpins (kompozisyon)', () => {
    fc.assert(
      fc.property(seedArb, betArb, (seed, bet) => {
        const r = round(seed, bet)
        const parts =
          r.base.totalWin +
          (r.jackpot?.win ?? 0) +
          (r.link?.totalWin ?? 0) +
          (r.freeSpins?.totalWin ?? 0)
        expect(r.totalWin).toBe(parts)
      }),
      { numRuns: 300 },
    )
  })

  it('jackpot: tier kademe tablosunda, win = bet × multiplier (tamsayı, lineer)', () => {
    fc.assert(
      fc.property(seedArb, betArb, (seed, bet) => {
        const r = round(seed, bet)
        if (!r.jackpot) return
        const rule = config.jackpot.tiers[r.jackpot.tier]
        expect(rule).toBeDefined()
        expect(r.jackpot.win).toBe(bet * rule.multiplier)
        expect(Number.isInteger(r.jackpot.win)).toBe(true)
        // Tur RNG akışı bet'ten bağımsız → aynı seed aynı kademeyi verir
        expect(round(seed, bet * 4).jackpot?.tier).toBe(r.jackpot.tier)
      }),
      { numRuns: 400 },
    )
  })

  it('tüm kazanç alanları tamsayı ve negatif değil', () => {
    fc.assert(
      fc.property(seedArb, betArb, (seed, bet) => {
        for (const v of money(round(seed, bet))) {
          expect(Number.isInteger(v)).toBe(true)
          expect(v).toBeGreaterThanOrEqual(0)
        }
      }),
      { numRuns: 300 },
    )
  })

  it('satır kazancı her zaman lineBet katıdır (kuruş kayması yok)', () => {
    fc.assert(
      fc.property(seedArb, betArb, (seed, bet) => {
        const lineBet = bet / LINE_COUNT
        const r = round(seed, bet)
        for (const w of r.base.lineWins) {
          expect(w.win % lineBet).toBe(0)
          expect(w.win).toBeGreaterThan(0)
        }
        if (r.base.scatterWin) {
          expect(r.base.scatterWin.win % bet).toBe(0)
        }
      }),
      { numRuns: 300 },
    )
  })

  it('lineer bet ölçeklemesi: win(k·bet) = k·win(bet) — TAM eşitlik', () => {
    // Tüm ödemeler bet'e orantılıdır (çizgi: lineBet, scatter: bet,
    // link hücreleri: bet çarpanı, jackpot: bet çarpanı, FS: çarpan).
    // Herhangi bir yuvarlama kayması bu özelliği KIRAR → yakalanır.
    fc.assert(
      fc.property(
        seedArb,
        betArb,
        fc.integer({ min: 2, max: 8 }),
        (seed, bet, k) => {
          expect(round(seed, bet * k).totalWin).toBe(
            round(seed, bet).totalWin * k,
          )
        },
      ),
      { numRuns: 300 },
    )
  })
})

describe('property: bonus yapısal bütünlüğü', () => {
  it('link: hücre toplamı (yuvarlanmış, bet çarpanı) == totalWin; pozisyonlar grid içinde', () => {
    fc.assert(
      fc.property(seedArb, betArb, (seed, bet) => {
        const r = round(seed, bet)
        if (!r.link) return
        const sum = r.link.cells.reduce(
          (s, c) => s + Math.round(c.value * bet),
          0,
        )
        expect(r.link.totalWin).toBe(sum)
        expect(r.link.triggerCount).toBeGreaterThanOrEqual(
          config.link.triggerCount,
        )
        for (const c of r.link.cells) {
          expect(c.reel).toBeGreaterThanOrEqual(0)
          expect(c.reel).toBeLessThan(config.reelCount)
          expect(c.row).toBeGreaterThanOrEqual(0)
          expect(c.row).toBeLessThan(3)
        }
      }),
      { numRuns: 300 },
    )
  })

  it('freeSpins: her dönüş result×çarpan, toplam = Σ dönüşler', () => {
    fc.assert(
      fc.property(seedArb, betArb, (seed, bet) => {
        const r = round(seed, bet)
        if (!r.freeSpins) return
        const mult = config.freeSpins.multiplier
        let sum = 0
        r.freeSpins.spins.forEach((fs, i) => {
          expect(fs.index).toBe(i)
          expect(fs.win).toBe(fs.result.totalWin * mult)
          sum += fs.win
        })
        expect(r.freeSpins.totalWin).toBe(sum)
        expect(r.freeSpins.spins.length).toBeGreaterThanOrEqual(
          config.freeSpins.award[3] ?? 13,
        )
      }),
      { numRuns: 200 },
    )
  })
})

describe('property: değerlendirme (evaluateGrid)', () => {
  /// 5 makara × 3 satır rastgeel grid
  const gridArb = fc
    .array(fc.array(fc.constantFrom(...SYMBOL_IDS), { minLength: 3, maxLength: 3 }), {
      minLength: config.reelCount,
      maxLength: config.reelCount,
    })
    .map((cols) => cols.map((c) => [...c]))

  it('rastgeel gridlerde totalWin = satır + scatter toplamı', () => {
    fc.assert(
      fc.property(gridArb, betArb, (columns, bet) => {
        const res = evaluateGrid(config, columns, bet)
        const sum =
          res.lineWins.reduce((s, w) => s + w.win, 0) +
          (res.scatterWin?.win ?? 0)
        expect(res.totalWin).toBe(sum)
      }),
      { numRuns: 300 },
    )
  })

  it('scatter ödemesi çarpan × bet ve sayım arttıkça AZALMAZ', () => {
    // config seviyesi (statik) + grid seviyesi (dinamik)
    const pays = config.scatter.pays
    const counts = Object.keys(pays)
      .map(Number)
      .sort((a, b) => a - b)
    for (let i = 1; i < counts.length; i++) {
      expect(pays[counts[i]]).toBeGreaterThanOrEqual(pays[counts[i - 1]])
    }

    fc.assert(
      fc.property(gridArb, betArb, (columns, bet) => {
        const res = evaluateGrid(config, columns, bet)
        if (res.scatterWin) {
          expect(res.scatterWin.win).toBe(res.scatterWin.multiplier * bet)
        }
      }),
      { numRuns: 200 },
    )
  })

  it('paytable satırları: daha çok sembol == daha yüksek veya eşit çarpan', () => {
    for (const row of Object.values(config.paytable)) {
      const ks = Object.keys(row)
        .map(Number)
        .sort((a, b) => a - b)
      for (let i = 1; i < ks.length; i++) {
        expect(row[ks[i]]).toBeGreaterThanOrEqual(row[ks[i - 1]])
      }
    }
  })
})

describe('property: RNG', () => {
  it('nextInt(max) her zaman [0, max) içinde', () => {
    fc.assert(
      fc.property(seedArb, fc.integer({ min: 1, max: 1e9 }), (seed, max) => {
        const rng = createRng(seed)
        for (let i = 0; i < 20; i++) {
          const v = rng.nextInt(max)
          expect(v).toBeGreaterThanOrEqual(0)
          expect(v).toBeLessThan(max)
        }
      }),
      { numRuns: 200 },
    )
  })

  it('kayıtlı durumdan devam = orijinal zincirin devamı (replay temeli)', () => {
    fc.assert(
      fc.property(seedArb, fc.integer({ min: 1, max: 50 }), (seed, cut) => {
        const a = createRng(seed)
        for (let i = 0; i < cut; i++) a.nextUint()
        const saved = a.state()
        const b = createRng(seed, saved) // atlamadan oradan devam
        for (let i = 0; i < 25; i++) {
          expect(b.nextUint()).toBe(a.nextUint())
        }
      }),
      { numRuns: 200 },
    )
  })

  it('aynı seed → aynı ilk çizimler (platform bağımsız determinizm)', () => {
    fc.assert(
      fc.property(seedArb, (seed) => {
        const a = createRng(seed)
        const b = createRng(seed)
        for (let i = 0; i < 100; i++) expect(a.nextUint()).toBe(b.nextUint())
      }),
      { numRuns: 100 },
    )
  })
})

describe('property: izinli bahis listesi motoru her zaman taşır', () => {
  it('ALLOWED_BETS her biri için tur hatasız ve lineer ölçeklenir', () => {
    for (const bet of ALLOWED_BETS) {
      const r = round('prop-allowed', bet)
      expect(r.totalWin).toBe(round('prop-allowed', bet * 2).totalWin / 2)
    }
  })
})
