import type { Rng } from './rng'
import type { GameConfig, SymbolId } from './types'

/**
 * Makaraları döndürür: her şeritten rastgele bir başlangıç seçilir,
 * `rows` kadar sembol pencere olarak alınır (sondan başa sarar).
 * Bu klasik "strip + window" modelidir; sembollerin yan yana dizilme
 * olasılıkları şerit içindeki SIRALARINDAN gelir — ağırlıktan değil.
 */
export function spinReels(config: GameConfig, rng: Rng): SymbolId[][] {
  if (config.strips.length !== config.reelCount) {
    throw new Error(
      `config hatalı: strips.length (${config.strips.length}) ≠ reelCount (${config.reelCount})`,
    )
  }
  return config.strips.map((strip) => {
    if (strip.length < config.rows) {
      throw new Error(`şerit çok kısa: ${strip.length} < rows ${config.rows}`)
    }
    const start = rng.nextInt(strip.length)
    const column: SymbolId[] = []
    for (let r = 0; r < config.rows; r++) {
      column.push(strip[(start + r) % strip.length])
    }
    return column
  })
}

/// Render/debug için grid'i satır bazlı okur: grid[row][reel]
export function toRows(columns: readonly (readonly SymbolId[])[]): SymbolId[][] {
  const rows = columns[0]?.length ?? 0
  return Array.from({ length: rows }, (_, r) => columns.map((col) => col[r]))
}
