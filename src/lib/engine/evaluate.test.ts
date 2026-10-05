import { describe, expect, it } from 'vitest'
import { evaluateGrid } from './evaluate'
import type { GameConfig, SymbolId } from './types'

/// Test için minimal config: 5×3, 2 çizgi, sabit paytable
const TEST_CONFIG: GameConfig = {
  name: 'test',
  reelCount: 5,
  rows: 3,
  bothWays: false,
  strips: Array.from({ length: 5 }, () => []),
  lines: [
    [1, 1, 1, 1, 1], // orta
    [0, 0, 0, 0, 0], // üst
  ],
  paytable: {
    bell: { 3: 10, 4: 50, 5: 200 },
    cherry: { 3: 2, 4: 8, 5: 40 },
    wild: { 3: 20, 4: 100, 5: 500 },
  },
  scatter: { symbol: 'scatter', pays: { 3: 2, 4: 10, 5: 50 } },
  wild: 'wild',
  link: {
    symbol: 'link',
    triggerCount: 6,
    respinCount: 3,
    cellCount: 15,
    values: { 1: 100 },
    jackpotChance: 0,
    stepCounts: { 0: 1 },
  },
  bell: {
    symbol: 'bell',
    triggerCount: 5,
    respinCount: 3,
    cellCount: 15,
    values: { 1: 100 },
    jackpotChance: 0,
    stepCounts: { 0: 1 },
    fullMultiplier: 3,
  },
  jackpot: {
    spinChance: 0,
    tiers: {
      mini: { weight: 1, multiplier: 10 },
      minor: { weight: 1, multiplier: 20 },
      maxi: { weight: 1, multiplier: 50 },
      major: { weight: 1, multiplier: 100 },
      grand: { weight: 1, multiplier: 500 },
    },
  },
  freeSpins: { award: { 3: 7, 4: 10, 5: 15 }, multiplier: 2, retriggerAward: 5 },
}

const BET = 200 // 2 çizgi → lineBet = 100

/// Grid'i kolon bazlı kur: grid kolonlar halinde [reel][row]
function grid(cols: SymbolId[][]): SymbolId[][] {
  expect(cols).toHaveLength(5)
  for (const c of cols) expect(c).toHaveLength(3)
  return cols
}

describe('evaluateGrid', () => {
  it('3 bell orta satırda kazandırır (3×lineBet)', () => {
    const columns = grid([
      ['cherry', 'bell', 'lemon'],
      ['lemon', 'bell', 'cherry'],
      ['cherry', 'bell', 'lemon'],
      ['lemon', 'grapes', 'cherry'],
      ['cherry', 'orange', 'lemon'],
    ])
    const r = evaluateGrid(TEST_CONFIG, columns, BET)
    expect(r.lineWins).toHaveLength(1)
    expect(r.lineWins[0]).toMatchObject({
      line: 0,
      direction: 'ltr',
      symbol: 'bell',
      count: 3,
      multiplier: 10,
      win: 10 * 100,
    })
    expect(r.totalWin).toBe(1000)
  })

  it('wild sembolün yerine geçer ve sayıyı büyütür', () => {
    // orta: wild, bell, bell, bell, x → 4 bell
    const columns = grid([
      ['cherry', 'wild', 'lemon'],
      ['lemon', 'bell', 'cherry'],
      ['cherry', 'bell', 'lemon'],
      ['lemon', 'bell', 'cherry'],
      ['cherry', 'grapes', 'lemon'],
    ])
    const r = evaluateGrid(TEST_CONFIG, columns, BET)
    const win = r.lineWins.find((w) => w.line === 0)!
    expect(win).toMatchObject({ symbol: 'bell', count: 4, multiplier: 50 })
    expect(win.win).toBe(50 * 100)
  })

  it('2 sembol kazanmaz (min 3)', () => {
    const columns = grid([
      ['cherry', 'bell', 'lemon'],
      ['lemon', 'bell', 'cherry'],
      ['cherry', 'grapes', 'lemon'],
      ['lemon', 'orange', 'cherry'],
      ['cherry', 'wild', 'lemon'],
    ])
    const r = evaluateGrid(TEST_CONFIG, columns, BET)
    // 2. çizgi (üst satır) cherry-cherry-grapes kırılır; cherry 2'de ödemez
    expect(r.lineWins).toHaveLength(0)
    expect(r.totalWin).toBe(0)
  })

  it('tamamen wild çizgi wild paytable’ı ile öder', () => {
    const columns = grid([
      ['cherry', 'wild', 'lemon'],
      ['lemon', 'wild', 'cherry'],
      ['cherry', 'wild', 'lemon'],
      ['lemon', 'wild', 'cherry'],
      ['cherry', 'wild', 'lemon'],
    ])
    const r = evaluateGrid(TEST_CONFIG, columns, BET)
    const win = r.lineWins.find((w) => w.line === 0)!
    expect(win).toMatchObject({ symbol: 'wild', count: 5, multiplier: 500 })
    expect(win.win).toBe(500 * 100)
  })

  it('scatter gridde her yerde 3+ ise totalBet üzerinden öder', () => {
    const columns = grid([
      ['scatter', 'cherry', 'lemon'],
      ['lemon', 'bell', 'scatter'],
      ['cherry', 'scatter', 'lemon'],
      ['lemon', 'orange', 'cherry'],
      ['cherry', 'wild', 'lemon'],
    ])
    const r = evaluateGrid(TEST_CONFIG, columns, BET)
    expect(r.scatterWin).toMatchObject({ count: 3, multiplier: 2, win: 2 * BET })
    expect(r.totalWin).toBe(2 * BET)
  })

  it('1-2 scatter ödemez', () => {
    const columns = grid([
      ['scatter', 'cherry', 'lemon'],
      ['lemon', 'bell', 'cherry'],
      ['cherry', 'grapes', 'lemon'],
      ['lemon', 'orange', 'cherry'],
      ['cherry', 'wild', 'lemon'],
    ])
    const r = evaluateGrid(TEST_CONFIG, columns, BET)
    expect(r.scatterWin).toBeNull()
  })

  it('birden fazla çizgi aynı anda kazanabilir (toplanır)', () => {
    // orta çizgi: cherry cherry cherry | orange → 3 cherry kazanır
    // üst çizgi: cherry cherry lemon → 2, ödemez
    const columns = grid([
      ['cherry', 'cherry', 'lemon'],
      ['cherry', 'cherry', 'cherry'],
      ['lemon', 'cherry', 'lemon'],
      ['lemon', 'orange', 'cherry'],
      ['cherry', 'wild', 'lemon'],
    ])
    const r = evaluateGrid(TEST_CONFIG, columns, BET)
    const cherryWin = r.lineWins.find((w) => w.symbol === 'cherry')
    expect(cherryWin).toMatchObject({ count: 3, win: 2 * 100 })
    expect(r.lineWins).toHaveLength(1)
    expect(r.totalWin).toBe(200)
  })

  it('bet çizgi sayısına bölünmüyorsa hata fırlatır', () => {
    const columns = grid([
      ['cherry', 'bell', 'lemon'],
      ['lemon', 'bell', 'cherry'],
      ['cherry', 'bell', 'lemon'],
      ['lemon', 'grapes', 'cherry'],
      ['cherry', 'orange', 'lemon'],
    ])
    expect(() => evaluateGrid(TEST_CONFIG, columns, 201)).toThrow(Error)
    expect(() => evaluateGrid(TEST_CONFIG, columns, 0)).toThrow(Error)
  })

  it('both-ways açıkken sağdan da okur ve tam çizgiyi iki kez saymaz', () => {
    const bothWays: GameConfig = { ...TEST_CONFIG, bothWays: true }
    const columns = grid([
      ['cherry', 'bell', 'lemon'],
      ['lemon', 'bell', 'cherry'],
      ['cherry', 'bell', 'lemon'],
      ['lemon', 'bell', 'cherry'],
      ['cherry', 'bell', 'lemon'],
    ])
    const r = evaluateGrid(bothWays, columns, BET)
    // 5 bell tam çizgi → ltr bir kez, rtl tekrar sayılmaz
    const bellWins = r.lineWins.filter((w) => w.symbol === 'bell')
    expect(bellWins).toHaveLength(1)
    expect(bellWins[0].count).toBe(5)
  })
})
