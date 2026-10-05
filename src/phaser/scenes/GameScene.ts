import Phaser from 'phaser'
import {
  CLOVER_LINK_BELLS,
  createRng,
  spin,
  type FreeSpinGame,
  type LinkBonus,
  type LinkCell,
  type SpinResult,
  type SpinRound,
  type SymbolId,
} from '@/lib/engine'
import { formatMinor, useGameStore } from '@/store/game-store'
import {
  BG,
  CANVAS_H,
  CANVAS_W,
  CELL_H,
  CELL_W,
  COLS,
  GOLD,
  GRID_H,
  GRID_W,
  GRID_X,
  GRID_Y,
  ROWS,
  SPIN_STRIPS,
  cellCenter,
} from '../layout'
import { buildTextures } from '../textures'

type CellImage = Phaser.GameObjects.Image | null

/**
 * Render sahnesi — matematik YAPMAZ.
 *
 * Veri akışı: store.spinId artınca `state.round` (SpinRound) alınır ve
 * sırayla oynatılır: base → link bonus → free spins. Sahne yalnızca
 * animasyon yapar; stageWin/settle ile HUD'u bilgilendirir.
 */
export class GameScene extends Phaser.Scene {
  private reels: Phaser.GameObjects.Container[] = []
  private cells: CellImage[][] = []
  private cellSymbols: SymbolId[][] = []
  private winText!: Phaser.GameObjects.Text
  private banner!: Phaser.GameObjects.Text
  private linkOverlay: Phaser.GameObjects.GameObject[] = []
  private highlightTweens: Phaser.Tweens.Tween[] = []
  private playing = false
  private lastSpinId = 0
  private unsub?: () => void

  constructor() {
    super('game')
  }

  create(): void {
    buildTextures(this)

    for (let r = 0; r < COLS; r++) {
      this.cells[r] = new Array<CellImage>(ROWS).fill(null)
      this.cellSymbols[r] = new Array<SymbolId>(ROWS).fill('cherry')
    }

    this.drawStatic()

    // Attract modu: rastgele bir turu STATİK göster (animasyonsuz)
    const attract = spin(CLOVER_LINK_BELLS, createRng('attract-1'), 200)
    this.renderColumns(attract.columns)

    // Her spinId artışında turu oynat
    this.unsub = useGameStore.subscribe((state, prev) => {
      if (state.spinId !== prev.spinId && state.round) {
        void this.play(state.round)
      }
    })
    this.events.once('shutdown', () => {
      this.unsub?.()
      this.unsub = undefined
    })
  }

  // ────────────────────────────────────────────── kurulum

  private drawStatic(): void {
    // Makara hücre zeminleri
    for (let r = 0; r < COLS; r++) {
      for (let row = 0; row < ROWS; row++) {
        this.add
          .rectangle(
            GRID_X + r * CELL_W + CELL_W / 2,
            GRID_Y + row * CELL_H + CELL_H / 2,
            CELL_W - 4,
            CELL_H - 4,
            0x111a2e,
          )
          .setDepth(-2)
      }
    }

    // Makara kapları (spin animasyonu burada yaşar)
    this.reels = []
    for (let r = 0; r < COLS; r++) {
      const container = this.add
        .container(GRID_X + r * CELL_W, GRID_Y)
        .setDepth(0)
      this.reels.push(container)
    }

    // Altın çerçeve
    const frame = this.add.graphics().setDepth(6)
    frame.lineStyle(3, GOLD, 1).strokeRect(GRID_X, GRID_Y, GRID_W, GRID_H)

    // Kırpma bantları: grid DIŞINA taşan hücreleri arka plan rengiyle örter
    // (mask yerine — basit ve WebGL/Canvas'ta aynı çalışır)
    const band = (x: number, y: number, w: number, h: number): void => {
      this.add.rectangle(x + w / 2, y + h / 2, w, h, BG).setDepth(5)
    }
    band(0, 0, CANVAS_W, GRID_Y)
    band(0, GRID_Y + GRID_H, CANVAS_W, CANVAS_H - GRID_Y - GRID_H)
    band(0, GRID_Y, GRID_X, GRID_H)
    band(GRID_X + GRID_W, GRID_Y, CANVAS_W - GRID_X - GRID_W, GRID_H)

    // Başlık (sabit) + dinamik banner + kazanç yazısı
    this.add
      .text(CANVAS_W / 2, 58, 'CLOVER LINK BELLS', {
        fontSize: '40px',
        fontFamily: 'Arial, sans-serif',
        fontStyle: 'bold',
        color: '#f5c542',
      })
      .setOrigin(0.5)
      .setDepth(20)

    this.banner = this.add
      .text(CANVAS_W / 2, 136, '', {
        fontSize: '30px',
        fontFamily: 'Arial, sans-serif',
        fontStyle: 'bold',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 4,
      })
      .setOrigin(0.5)
      .setDepth(20)

    this.winText = this.add
      .text(CANVAS_W / 2, GRID_Y + GRID_H + 75, '', {
        fontSize: '52px',
        fontFamily: 'Arial, sans-serif',
        fontStyle: 'bold',
        color: '#f5c542',
        stroke: '#000000',
        strokeThickness: 6,
      })
      .setOrigin(0.5)
      .setDepth(20)
  }

  // ────────────────────────────────────────────── statik grid

  private clearGrid(): void {
    for (let r = 0; r < COLS; r++) {
      for (let row = 0; row < ROWS; row++) {
        this.cells[r][row]?.destroy()
        this.cells[r][row] = null
      }
    }
  }

  private renderColumns(columns: readonly (readonly SymbolId[])[]): void {
    this.clearGrid()
    columns.forEach((col, r) => {
      col.forEach((sym, row) => {
        const { x, y } = cellCenter(r, row)
        const img = this.add.image(x, y, `sym-${sym}`).setDepth(2)
        this.cells[r][row] = img
        this.cellSymbols[r][row] = sym
      })
    })
  }

  // ────────────────────────────────────────────── animasyon

  private animateSpin(columns: readonly (readonly SymbolId[])[]): Promise<void> {
    this.winText.setText('')
    this.stopHighlight()
    this.clearGrid()
    return Promise.all(columns.map((col, r) => this.spinReel(r, col))).then(
      () => {
        // Scroll bitti: container'ları boşalt, kalıcı hücreleri yerleştir
        this.reels.forEach((c) => c.removeAll(true))
        this.renderColumns(columns)
      },
    )
  }

  private spinReel(r: number, col: readonly SymbolId[]): Promise<void> {
    const container = this.reels[r]
    container.removeAll(true)
    container.setPosition(GRID_X + r * CELL_W, GRID_Y)

    const strip = CLOVER_LINK_BELLS.strips[r]
    const intermediates: Phaser.GameObjects.Image[] = []
    const finals: Phaser.GameObjects.Image[] = []

    // Ara şerit: ekranda ilk görünenler (satır 0..SPIN_STRIPS-1)
    for (let i = 0; i < SPIN_STRIPS; i++) {
      const sym = strip[Phaser.Math.Between(0, strip.length - 1)]
      const img = this.add.image(
        CELL_W / 2,
        i * CELL_H + CELL_H / 2,
        `sym-${sym}`,
      )
      container.add(img)
      intermediates.push(img)
    }

    // Final hücreler: grid'in ALTINDA başlar, yukarı kayarak oturur
    col.forEach((sym, row) => {
      const img = this.add.image(
        CELL_W / 2,
        (SPIN_STRIPS + row) * CELL_H + CELL_H / 2,
        `sym-${sym}`,
      )
      container.add(img)
      finals.push(img)
    })

    return new Promise((resolve) => {
      this.tweens.add({
        targets: container,
        y: GRID_Y - SPIN_STRIPS * CELL_H,
        duration: 950,
        delay: r * 130, // makaralar sırayla dursun
        ease: 'Cubic.easeOut',
        onComplete: () => {
          intermediates.forEach((img) => img.destroy())
          finals.forEach((img) => img.setY(img.y - SPIN_STRIPS * CELL_H))
          container.y = GRID_Y
          resolve()
        },
      })
    })
  }

  private highlightResult(result: SpinResult): void {
    const positions = new Set<string>()
    const lines = CLOVER_LINK_BELLS.lines

    for (const w of result.lineWins) {
      const lineRows = lines[w.line]
      if (w.direction === 'ltr') {
        for (let i = 0; i < w.count; i++) positions.add(`${i}:${lineRows[i]}`)
      } else {
        for (let i = 0; i < w.count; i++) {
          const c = COLS - 1 - i
          positions.add(`${c}:${lineRows[c]}`)
        }
      }
    }

    if (result.scatterWin) {
      for (let r = 0; r < COLS; r++) {
        for (let row = 0; row < ROWS; row++) {
          if (this.cellSymbols[r][row] === CLOVER_LINK_BELLS.scatter.symbol) {
            positions.add(`${r}:${row}`)
          }
        }
      }
    }

    for (const key of positions) {
      const [r, row] = key.split(':').map(Number)
      const img = this.cells[r][row]
      if (!img) continue
      this.highlightTweens.push(
        this.tweens.add({
          targets: img,
          scale: { from: 1, to: 1.12 },
          yoyo: true,
          repeat: -1,
          duration: 320,
        }),
      )
    }
  }

  private stopHighlight(): void {
    this.highlightTweens.forEach((t) => t.stop())
    this.highlightTweens = []
    for (let r = 0; r < COLS; r++) {
      for (let row = 0; row < ROWS; row++) {
        this.cells[r][row]?.setScale(1)
      }
    }
  }

  private showWin(amount: number): Promise<void> {
    return new Promise((resolve) => {
      const obj = { v: 0 }
      this.tweens.add({
        targets: obj,
        v: amount,
        duration: 750,
        ease: 'Cubic.easeOut',
        onUpdate: () =>
          this.winText.setText(`KAZANÇ ${formatMinor(Math.round(obj.v))}`),
        onComplete: () => {
          this.winText.setText(`KAZANÇ ${formatMinor(amount)}`)
          this.tweens.add({
            targets: this.winText,
            scale: { from: 1.2, to: 1 },
            duration: 260,
            ease: 'Back.easeOut',
          })
          resolve()
        },
      })
    })
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      if (!this.scene.isActive()) {
        resolve()
        return
      }
      this.time.delayedCall(ms, () => resolve())
    })
  }

  private setBanner(text: string): void {
    this.banner.setText(text)
  }

  // ────────────────────────────────────────────── bonuslar

  private popLinkCell(cell: LinkCell): void {
    const { x, y } = cellCenter(cell.reel, cell.row)
    const img = this.add.image(x, y, 'sym-link').setDepth(3).setScale(0)
    const label = this.add
      .text(
        x,
        y + 34,
        cell.tier ? cell.tier.toUpperCase() : `${cell.value}×`,
        {
          fontSize: '22px',
          fontFamily: 'Arial, sans-serif',
          fontStyle: 'bold',
          color: cell.tier ? '#f5c542' : '#ffffff',
          stroke: '#000000',
          strokeThickness: 4,
        },
      )
      .setOrigin(0.5)
      .setDepth(4)
      .setScale(0)

    this.linkOverlay.push(img, label)
    this.tweens.add({
      targets: [img, label],
      scale: 1,
      duration: 280,
      ease: 'Back.easeOut',
    })
  }

  private clearLinkOverlay(): void {
    this.linkOverlay.forEach((obj) => obj.destroy())
    this.linkOverlay = []
  }

  private async playLink(link: LinkBonus): Promise<void> {
    this.setBanner('LINK BONUS!')
    await this.delay(700)

    for (const step of link.steps) {
      this.setBanner(`RESPINS ${step.respinsLeft}`)
      for (const cell of step.added) {
        this.popLinkCell(cell)
        await this.delay(150)
      }
      await this.delay(step.added.length > 0 ? 650 : 300)
    }

    if (link.jackpots.length > 0) {
      this.setBanner(
        `JACKPOT! ${link.jackpots.map((t) => t.toUpperCase()).join(' + ')}`,
      )
      await this.delay(1000)
    }

    useGameStore.getState().stageWin(link.totalWin)
    await this.showWin(link.totalWin)
    await this.delay(1400)

    this.clearLinkOverlay()
    this.setBanner('')
  }

  private async playFreeSpins(game: FreeSpinGame): Promise<void> {
    const total = game.spins.length
    useGameStore.getState().setPhase('freespins')

    for (const [i, fs] of game.spins.entries()) {
      const label = `BEDAVA DÖNÜŞ ${i + 1}/${total}`
      useGameStore.getState().setFsLabel(label)
      this.setBanner(`${label}  ×${CLOVER_LINK_BELLS.freeSpins.multiplier}`)

      await this.animateSpin(fs.result.columns)

      if (fs.win > 0) {
        useGameStore.getState().stageWin(fs.win)
        this.highlightResult(fs.result)
        await this.showWin(fs.win)
        await this.delay(550)
        this.stopHighlight()
      }
      await this.delay(250)
    }

    useGameStore.getState().setFsLabel(null)
  }

  // ────────────────────────────────────────────── tur oynatma

  private async play(round: SpinRound): Promise<void> {
    if (this.playing) return
    this.playing = true

    try {
      await this.animateSpin(round.base.columns)

      if (round.base.totalWin > 0) {
        useGameStore.getState().stageWin(round.base.totalWin)
        this.highlightResult(round.base)
        await this.showWin(round.base.totalWin)
        await this.delay(700)
        this.stopHighlight()
      }

      if (round.link) {
        useGameStore.getState().setPhase('link')
        await this.playLink(round.link)
      }

      if (round.freeSpins) {
        await this.playFreeSpins(round.freeSpins)
      }
    } finally {
      this.playing = false
      this.setBanner('')
      useGameStore.getState().settle()
    }
  }
}
