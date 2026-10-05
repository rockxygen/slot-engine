import type Phaser from 'phaser'
import { CLOVER_LINK_BELLS, JACKPOT_TIERS } from '@/lib/engine'
import {
  CANVAS_H,
  CANVAS_W,
  CELL_H,
  CELL_W,
  JACKPOT_CHIP_H,
  JACKPOT_CHIP_W,
  JACKPOT_META,
  SYMBOL_META,
} from './layout'

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

/// #rrggbb → [r, g, b]
function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/// Rengi `t` kadar beyaza (t>0) veya siyaha (t<0) kaydırır.
function shade(hex: string, t: number): string {
  const [r, g, b] = rgb(hex)
  const [tr, tg, tb] = t >= 0 ? [255, 255, 255] : [0, 0, 0]
  const k = Math.abs(t)
  const m = (a: number, c: number): number => Math.round(a + (c - a) * k)
  return `rgb(${m(r, tr)}, ${m(g, tg)}, ${m(b, tb)})`
}

/// Deterministik gürültü (yıldız tozu yerleşimi test edilebilir kalsın)
function seededRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/// Tam ekran arka plan: gradient + ortam ışıması + yıldız tozu + vignette.
/// Kırpma bantları (GameScene) AYNI dokunun bölgesel kopyalarıdır — böylece
/// gradient bantlar boyunca kesintisiz sürer.
function buildBackground(tm: Phaser.Textures.TextureManager): void {
  if (tm.exists('bg')) return
  const ct = tm.createCanvas('bg', CANVAS_W, CANVAS_H)
  if (!ct) return
  const ctx = ct.context

  const grad = ctx.createLinearGradient(0, 0, 0, CANVAS_H)
  grad.addColorStop(0, '#0c1526')
  grad.addColorStop(0.5, '#0b1220')
  grad.addColorStop(1, '#080d18')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H)

  // Ortam ışıması (ADD karışımı)
  ctx.globalCompositeOperation = 'lighter'
  const glow = (cx: number, cy: number, r: number, color: string): void => {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
    g.addColorStop(0, color)
    g.addColorStop(1, 'rgba(0, 0, 0, 0)')
    ctx.fillStyle = g
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2)
  }
  glow(540, 330, 540, 'rgba(245, 197, 66, 0.10)') // makara arkası
  glow(540, 66, 320, 'rgba(245, 197, 66, 0.05)') // başlık arkası
  glow(140, 620, 380, 'rgba(45, 212, 191, 0.05)') // sol alt turkuaz
  glow(950, 640, 380, 'rgba(139, 92, 246, 0.06)') // sağ alt mor

  // Yıldız tozu
  const rnd = seededRng(0x51a7)
  for (let i = 0; i < 130; i++) {
    const x = rnd() * CANVAS_W
    const y = rnd() * CANVAS_H
    ctx.globalAlpha = 0.06 + rnd() * 0.2
    ctx.fillStyle = rnd() < 0.3 ? '#f5c542' : '#cbd5e1'
    ctx.beginPath()
    ctx.arc(x, y, 0.5 + rnd() * 1.1, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'

  // Vignette (kenar karartması)
  const v = ctx.createRadialGradient(540, 360, 260, 540, 360, 720)
  v.addColorStop(0, 'rgba(0, 0, 0, 0)')
  v.addColorStop(1, 'rgba(0, 0, 0, 0.5)')
  ctx.fillStyle = v
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H)

  ct.refresh()
}

/// Sembol kartları: gradient zemin, accent kenar parıltısı, gloss, gölgeli emoji.
function buildSymbolCards(tm: Phaser.Textures.TextureManager): void {
  if (tm.exists('sym-wild')) return
  const w = CELL_W - PAD * 2
  const h = CELL_H - PAD * 2

  for (const [id, meta] of Object.entries(SYMBOL_META)) {
    const ct = tm.createCanvas(`sym-${id}`, w, h)
    if (!ct) continue
    const ctx = ct.context
    ctx.clearRect(0, 0, w, h)

    // Kart gövdesi (dış gölge ile zeminden ayrışır)
    ctx.save()
    ctx.shadowColor = 'rgba(0, 0, 0, 0.45)'
    ctx.shadowBlur = 8
    ctx.shadowOffsetY = 4
    roundRect(ctx, 2, 2, w - 4, h - 6, 14)
    const g = ctx.createLinearGradient(0, 0, 0, h)
    g.addColorStop(0, shade(meta.bg, 0.18))
    g.addColorStop(0.55, meta.bg)
    g.addColorStop(1, shade(meta.bg, -0.35))
    ctx.fillStyle = g
    ctx.fill()
    ctx.restore()

    // Accent kenar (sembol ücretine göre renk) + iç beyaz halka
    roundRect(ctx, 2, 2, w - 4, h - 6, 14)
    ctx.lineWidth = 3
    ctx.globalAlpha = 0.85
    ctx.strokeStyle = meta.accent
    ctx.stroke()
    ctx.globalAlpha = 1
    roundRect(ctx, 6, 6, w - 12, h - 14, 11)
    ctx.lineWidth = 1.5
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)'
    ctx.stroke()

    // Üst parlaklık (gloss) — kart sınırıyla kırpılır
    ctx.save()
    roundRect(ctx, 2, 2, w - 4, h - 6, 14)
    ctx.clip()
    const gloss = ctx.createLinearGradient(0, 4, 0, h * 0.5)
    gloss.addColorStop(0, 'rgba(255, 255, 255, 0.14)')
    gloss.addColorStop(1, 'rgba(255, 255, 255, 0)')
    ctx.fillStyle = gloss
    ctx.fillRect(0, 0, w, h * 0.5)
    ctx.restore()

    // Emoji: yumuşak düşen gölge ile ortalanır
    ctx.font = '46px "Segoe UI Emoji", "Noto Color Emoji", sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)'
    ctx.shadowBlur = 6
    ctx.shadowOffsetY = 3
    ctx.fillText(meta.emoji, w / 2, h / 2 + 1)
    ctx.shadowColor = 'transparent'
    ctx.shadowBlur = 0
    ctx.shadowOffsetY = 0

    ct.refresh()
  }
}

/// Partikül dokusu: beyaz radyal nokta — tint ile renklendirilir.
function buildSpark(tm: Phaser.Textures.TextureManager): void {
  if (tm.exists('spark')) return
  const size = 24
  const ct = tm.createCanvas('spark', size, size)
  if (!ct) return
  const ctx = ct.context
  ctx.clearRect(0, 0, size, size)
  const g = ctx.createRadialGradient(12, 12, 0, 12, 12, 12)
  g.addColorStop(0, 'rgba(255, 255, 255, 1)')
  g.addColorStop(0.35, 'rgba(255, 255, 255, 0.55)')
  g.addColorStop(1, 'rgba(255, 255, 255, 0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  ct.refresh()
}

/// Kazanç hücresi parıltısı: altın yuvarlak köşeli çerçeve + dış ışıma.
function buildCellGlow(tm: Phaser.Textures.TextureManager): void {
  if (tm.exists('glow-cell')) return
  const w = CELL_W - 4
  const h = CELL_H - 4
  const ct = tm.createCanvas('glow-cell', w, h)
  if (!ct) return
  const ctx = ct.context
  ctx.clearRect(0, 0, w, h)

  ctx.save()
  ctx.shadowColor = 'rgba(245, 197, 66, 0.9)'
  ctx.shadowBlur = 14
  roundRect(ctx, 6, 6, w - 12, h - 12, 12)
  ctx.lineWidth = 4
  ctx.strokeStyle = '#f5c542'
  ctx.stroke()
  ctx.stroke() // ikinci katman: daha parlak çekirdek
  ctx.restore()

  roundRect(ctx, 9.5, 9.5, w - 19, h - 19, 10)
  ctx.lineWidth = 1
  ctx.strokeStyle = 'rgba(255, 240, 200, 0.8)'
  ctx.stroke()

  ct.refresh()
}

/// Jackpot prize bar çipleri: kademe renginde plaka + isim + bahis katı
/// (`MINI 10×` — ödül her zaman bet × bu kat; config'den okunur, kod değil).
function buildJackpotChips(tm: Phaser.Textures.TextureManager): void {
  const w = JACKPOT_CHIP_W
  const h = JACKPOT_CHIP_H

  for (const tier of JACKPOT_TIERS) {
    const key = `jp-${tier}`
    if (tm.exists(key)) continue
    const ct = tm.createCanvas(key, w, h)
    if (!ct) continue
    const ctx = ct.context
    const meta = JACKPOT_META[tier]
    const mult = CLOVER_LINK_BELLS.jackpot.tiers[tier].multiplier
    ctx.clearRect(0, 0, w, h)

    // Plaka gövdesi (kademe rengi gradient + gölge)
    ctx.save()
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)'
    ctx.shadowBlur = 6
    ctx.shadowOffsetY = 2
    roundRect(ctx, 1.5, 1.5, w - 3, h - 4, 8)
    const g = ctx.createLinearGradient(0, 0, 0, h)
    g.addColorStop(0, shade(meta.bg, 0.2))
    g.addColorStop(0.55, meta.bg)
    g.addColorStop(1, shade(meta.bg, -0.3))
    ctx.fillStyle = g
    ctx.fill()
    ctx.restore()

    // Kademe accent kenarı + iç ince halka
    roundRect(ctx, 1.5, 1.5, w - 3, h - 4, 8)
    ctx.lineWidth = 2
    ctx.globalAlpha = 0.9
    ctx.strokeStyle = meta.accent
    ctx.stroke()
    ctx.globalAlpha = 1
    roundRect(ctx, 4.5, 4.5, w - 9, h - 10, 6)
    ctx.lineWidth = 1
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)'
    ctx.stroke()

    // Metin: kademe adı (accent) + çarpan (altın), gölgeli ortalanır
    const label = tier.toUpperCase()
    const multText = `${mult}×`
    ctx.font = 'bold 15px Arial, sans-serif'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    const nameW = ctx.measureText(label).width
    const gap = 8
    const multW = ctx.measureText(multText).width
    const startX = (w - (nameW + gap + multW)) / 2
    ctx.shadowColor = 'rgba(0, 0, 0, 0.65)'
    ctx.shadowBlur = 3
    ctx.shadowOffsetY = 1
    ctx.fillStyle = meta.accent
    ctx.fillText(label, startX, h / 2 + 1)
    ctx.fillStyle = '#f5c542'
    ctx.fillText(multText, startX + nameW + gap, h / 2 + 1)
    ctx.shadowColor = 'transparent'
    ctx.shadowBlur = 0
    ctx.shadowOffsetY = 0

    ct.refresh()
  }
}

/**
 * Tüm oyun dokularını çalışma anında pişirir (dış dosya yok).
 * Kimlikler emoji'den gelir; zemin/accent renkleri SYMBOL_META'dan.
 * Her doku kendi korumasıyla ikinci kez oluşturulursa sessizce atlanır
 * (React StrictMode çift mount'ta güvenli).
 */
export function buildTextures(scene: Phaser.Scene): void {
  const tm = scene.textures
  buildBackground(tm)
  buildSymbolCards(tm)
  buildJackpotChips(tm)
  buildSpark(tm)
  buildCellGlow(tm)
}
