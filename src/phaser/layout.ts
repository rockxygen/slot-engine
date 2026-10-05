import type { SymbolId } from '@/lib/engine'

/// Fiziksel sahne boyutu — Scale.FIT ile pencereye sığar
export const CANVAS_W = 1080
export const CANVAS_H = 720

export const COLS = 5
export const ROWS = 3
export const CELL_W = 140
export const CELL_H = 120
export const GRID_W = COLS * CELL_W // 700
export const GRID_H = ROWS * CELL_H // 360
export const GRID_X = Math.round((CANVAS_W - GRID_W) / 2) // 190
export const GRID_Y = 190

/// Spin sırasında makarada dönen ara sembol sayısı (final 3 hariç)
export const SPIN_STRIPS = 8

/// Arka plan (overlay dikdörtgenleri aynı renkte → kırpma etkisi)
export const BG = 0x0b1220
export const BG_CSS = '#0b1220'
export const GOLD = 0xf5c542

/// Hücre merkezi (sahne koordinatı)
export function cellCenter(col: number, row: number): { x: number; y: number } {
  return {
    x: GRID_X + col * CELL_W + CELL_W / 2,
    y: GRID_Y + row * CELL_H + CELL_H / 2,
  }
}

/// Sembol sunumu: emoji + kart zemini (doku `textures.ts`'te pişirilir)
export const SYMBOL_META: Record<SymbolId, { emoji: string; bg: string }> = {
  wild: { emoji: '🍀', bg: '#14532d' },
  scatter: { emoji: '⭐', bg: '#78350f' },
  link: { emoji: '🪙', bg: '#78350f' },
  bell: { emoji: '🔔', bg: '#7c2d12' },
  seven: { emoji: '7️⃣', bg: '#7f1d1d' },
  watermelon: { emoji: '🍉', bg: '#166534' },
  grapes: { emoji: '🍇', bg: '#3b0764' },
  orange: { emoji: '🍊', bg: '#7c2d12' },
  lemon: { emoji: '🍋', bg: '#713f12' },
  cherry: { emoji: '🍒', bg: '#7f1d1d' },
}
