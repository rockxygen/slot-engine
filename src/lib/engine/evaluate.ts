import type {
  Direction,
  GameConfig,
  LineWin,
  ScatterWin,
  SymbolId,
} from './types'

/**
 * Bir çizginin sembollerini okur: `rows[reel]` indeksleriyle grid'den
 * sembol dizisi çıkarılır (soldan sağa sırayla).
 */
function lineSymbols(
  columns: readonly (readonly SymbolId[])[],
  rows: readonly number[],
): SymbolId[] {
  return rows.map((row, reel) => columns[reel][row])
}

/**
 * Tek bir yön için çizgi kazancını hesaplar.
 * Kurallar:
 *  - Soldan (veya sağdan) ardışık eşleşme; wild her sembolün yerine geçer.
 *  - Hedef sembol = soldan (sağdan) ilk WILD OLMAYAN sembol; hiç yoksa wild.
 *  - `paytable[symbol][count]` yoksa (min sayıdan az) kazanç yoktur.
 *  - Kazanç = çarpan × lineBet (tamsayı).
 */
function evaluateDirection(
  config: GameConfig,
  columns: readonly (readonly SymbolId[])[],
  rows: readonly number[],
  direction: Direction,
  lineIndex: number,
  lineBet: number,
): LineWin | null {
  const syms = lineSymbols(columns, rows)
  const ordered = direction === 'ltr' ? syms : [...syms].reverse()

  // Hedef: ilk wild olmayan sembol (wild'lar yerine koyar)
  const target = ordered.find((s) => s !== config.wild) ?? config.wild
  const pay = config.paytable[target]
  if (!pay) return null

  // Ardışık sayım (wild eşleşir); wild kendi paytable'ı ile de öder:
  // tamamı wild ise hedef zaten wild'tır.
  let count = 0
  for (const s of ordered) {
    if (s === target || s === config.wild) count++
    else break
  }

  const multiplier = pay[count]
  if (!multiplier) return null

  return {
    line: lineIndex,
    direction,
    symbol: target,
    count,
    multiplier,
    win: multiplier * lineBet,
  }
}

/**
 * Grid'in tamamını değerlendirir: 20 çizgi (+ both-ways ise sağdan),
 * her makarada görünen scatter'lar (çizgiden bağımsız, 3+ öder).
 *
 * `bothWays` açıkken iki yön de okunur; aynı sembolün 5'lisi (tam çizgi)
 * iki kez sayılmaz — max alınır.
 */
export function evaluateGrid(
  config: GameConfig,
  columns: readonly (readonly SymbolId[])[],
  bet: number,
): { lineWins: LineWin[]; scatterWin: ScatterWin | null; totalWin: number } {
  const lineCount = config.lines.length
  if (bet <= 0 || bet % lineCount !== 0) {
    throw new Error(`bet, çizgi sayısına (${lineCount}) tam bölünmeli: ${bet}`)
  }
  const lineBet = bet / lineCount

  const lineWins: LineWin[] = []
  config.lines.forEach((rows, i) => {
    const ltr = evaluateDirection(config, columns, rows, 'ltr', i, lineBet)
    if (ltr) lineWins.push(ltr)

    if (config.bothWays) {
      const rtl = evaluateDirection(config, columns, rows, 'rtl', i, lineBet)
      // Aynı 5'li (tam çizgi) iki yönden de aynı kazançtır → tekrar sayma
      const duplicate =
        rtl && ltr && rtl.count === config.reelCount && ltr.count === config.reelCount
      if (rtl && !duplicate) lineWins.push(rtl)
    }
  })

  // Scatter: tüm grid'de sayılır, totalBet üzerinden öder.
  // 5+ scatter, paytable'daki en yüksek anahtar kadar sayılır (clamp).
  const scatterSymbol = config.scatter.symbol
  let scatterCount = 0
  for (const column of columns) {
    for (const s of column) if (s === scatterSymbol) scatterCount++
  }
  const pays = config.scatter.pays
  const maxPayKey = Math.max(...Object.keys(pays).map(Number))
  const capped = Math.min(scatterCount, maxPayKey)
  const scatterMultiplier = pays[capped]
  const scatterWin: ScatterWin | null =
    scatterCount >= Math.min(...Object.keys(pays).map(Number)) && scatterMultiplier !== undefined
      ? { count: scatterCount, multiplier: scatterMultiplier, win: scatterMultiplier * bet }
      : null

  const totalWin =
    lineWins.reduce((sum, w) => sum + w.win, 0) + (scatterWin?.win ?? 0)

  return { lineWins, scatterWin, totalWin }
}
