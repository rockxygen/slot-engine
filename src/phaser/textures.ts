import type Phaser from 'phaser'
import { CELL_H, CELL_W, SYMBOL_META } from './layout'

const PAD = 4

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/**
 * Sembol kartlarını çalışma anında pişirir (dış dosya yok).
 * Kimlik emoji'den gelir; zemin rengi SYMBOL_META'dan.
 * Aynı texture anahtarları ikinci kez oluşturulursa sessizce atlanır
 * (React StrictMode çift mount'ta güvenli).
 */
export function buildTextures(scene: Phaser.Scene): void {
  const tm = scene.textures
  if (tm.exists('sym-wild')) return

  const w = CELL_W - PAD * 2
  const h = CELL_H - PAD * 2

  for (const [id, meta] of Object.entries(SYMBOL_META)) {
    const ct = tm.createCanvas(`sym-${id}`, w, h)
    if (!ct) continue
    const ctx = ct.context

    ctx.clearRect(0, 0, w, h)
    roundRect(ctx, 1, 1, w - 2, h - 2, 14)
    ctx.fillStyle = meta.bg
    ctx.fill()
    ctx.lineWidth = 3
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)'
    ctx.stroke()

    ctx.font = '46px "Segoe UI Emoji", "Noto Color Emoji", sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(meta.emoji, w / 2, h / 2 + 2)

    ct.refresh()
  }
}
