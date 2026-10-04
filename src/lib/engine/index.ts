/// Slot motoru — saf matematik katmanı (framework'süz, sunucu+istemci
/// ortak çalışır). Görselleştirme bu paketin DIŞINDADIR.
export { createRng, randomSeed, type Rng, type RngState } from './rng'
export { CLOVER_LINK_BELLS, LINE_COUNT } from './config'
export { spinReels, toRows } from './reels'
export { evaluateGrid } from './evaluate'
export { spin } from './spin'
export { playRound } from './round'
export { playLinkBonus, playFreeSpins } from './bonus'
export { simulate, formatStats, type SimOptions, type SimStats } from './simulate'
export type {
  Direction,
  FreeSpin,
  FreeSpinConfig,
  FreeSpinGame,
  GameConfig,
  JackpotRule,
  JackpotTier,
  LineWin,
  LinkBonus,
  LinkCell,
  LinkConfig,
  LinkStep,
  PayRow,
  ScatterRule,
  ScatterWin,
  SpinResult,
  SpinRound,
  SymbolId,
} from './types'
export { SYMBOL_IDS } from './types'
