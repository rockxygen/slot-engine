/// Slot motoru — saf matematik katmanı (framework'süz, sunucu+istemci
/// ortak çalışır). Görselleştirme bu paketin DIŞINDADIR.
export { createRng, randomSeed, type Rng, type RngState } from './rng'
export { CLOVER_LINK_BELLS, LINE_COUNT } from './config'
export { spinReels, toRows } from './reels'
export { evaluateGrid } from './evaluate'
export { spin } from './spin'
export { simulate, formatStats, type SimOptions, type SimStats } from './simulate'
export type {
  Direction,
  GameConfig,
  LineWin,
  PayRow,
  ScatterRule,
  ScatterWin,
  SpinResult,
  SymbolId,
} from './types'
export { SYMBOL_IDS } from './types'
