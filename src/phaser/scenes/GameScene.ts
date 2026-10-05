import Phaser from 'phaser'
import { SOUND_NAMES, type SoundName } from '@/lib/audio/synth'
import {
  CLOVER_LINK_BELLS,
  JACKPOT_TIERS,
  createRng,
  spin,
  type FreeSpinGame,
  type JackpotHit,
  type LinkBonus,
  type LinkCell,
  type SpinResult,
  type SpinRound,
  type SymbolId,
} from '@/lib/engine'
import { formatMinor, loadSoundPref, useGameStore } from '@/store/game-store'
import {
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
  JACKPOT_BAR_Y,
  ROWS,
  SPIN_STRIPS,
  cellCenter,
  jackpotChipX,
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
  private winGlow!: Phaser.GameObjects.Image
  private banner!: Phaser.GameObjects.Text
  private jackpotChips: Phaser.GameObjects.Image[] = []
  private linkOverlay: Phaser.GameObjects.GameObject[] = []
  private highlightTweens: Phaser.Tweens.Tween[] = []
  private highlightGlows: Phaser.GameObjects.Image[] = []
  private playing = false
  private lastSpinId = 0
  private unsub?: () => void

  constructor() {
    super('game')
  }

  private preload(): void {
    // Sentezlenmiş WAV'lar (`npm run audio:gen`) — dosya yoksa sessiz atlanır
    for (const name of SOUND_NAMES) this.load.audio(name, `audio/${name}.wav`)
  }

  create(): void {
    buildTextures(this)

    // Ses tercihi localStorage'dan okunur (SSR SONRASI → hydration uyumlu)
    useGameStore.setState({ soundOn: loadSoundPref() })
    this.sound.mute = !useGameStore.getState().soundOn

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
      if (state.soundOn !== prev.soundOn) this.sound.mute = !state.soundOn
      if (state.spinId !== prev.spinId && state.round) {
        void this.play(state.round)
      }
    })
    this.events.once('shutdown', () => {
      this.unsub?.()
      this.unsub = undefined
    })
  }

  // ────────────────────────────────────────────── ses

  /// Güvenli çalma: dosya yüklenmediyse (asset eksikse) sessiz geç.
  private sfx(name: SoundName, cfg?: Phaser.Types.Sound.SoundConfig): void {
    if (!this.cache.audio.exists(name)) return
    this.sound.play(name, cfg)
  }

  // ────────────────────────────────────────────── kurulum

  private drawStatic(): void {
    // Arka plan: gradient + ortam ışıması + vignette (tek doku, `textures.ts`)
    this.add.image(0, 0, 'bg').setOrigin(0).setDepth(-10)

    // Makara paneli: koyu plaka + çift altın halka (grid'in arkasında)
    const panel = this.add.graphics().setDepth(-6)
    panel.fillStyle(0x05080f, 0.75)
    panel.fillRoundedRect(GRID_X - 16, GRID_Y - 16, GRID_W + 32, GRID_H + 32, 18)
    panel.lineStyle(8, GOLD, 0.07)
    panel.strokeRoundedRect(GRID_X - 22, GRID_Y - 22, GRID_W + 44, GRID_H + 44, 24)
    panel.lineStyle(2, GOLD, 0.4)
    panel.strokeRoundedRect(GRID_X - 16, GRID_Y - 16, GRID_W + 32, GRID_H + 32, 18)

    // Makara hücre zeminleri
    for (let r = 0; r < COLS; r++) {
      for (let row = 0; row < ROWS; row++) {
        this.add
          .rectangle(
            GRID_X + r * CELL_W + CELL_W / 2,
            GRID_Y + row * CELL_H + CELL_H / 2,
            CELL_W - 4,
            CELL_H - 4,
            0x070b16,
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

    // Makara ayırıcıları (kartların üstünde ince altın dikeyler)
    const sep = this.add.graphics().setDepth(3)
    sep.lineStyle(1, GOLD, 0.16)
    for (let r = 1; r < COLS; r++) {
      const x = GRID_X + r * CELL_W
      sep.lineBetween(x, GRID_Y + 6, x, GRID_Y + GRID_H - 6)
    }

    // Kırpma bantları: AYNI bg dokusunun bölgesel kopyası → gradient kesintisiz
    // sürer, makara taşmaları şeffaflaşmadan örter (mask yerine — WebGL/Canvas
    // aynı çalışır)
    const band = (x: number, y: number, w: number, h: number): void => {
      this.add.image(0, 0, 'bg').setOrigin(0).setCrop(x, y, w, h).setDepth(5)
    }
    band(0, 0, CANVAS_W, GRID_Y)
    band(0, GRID_Y + GRID_H, CANVAS_W, CANVAS_H - GRID_Y - GRID_H)
    band(0, GRID_Y, GRID_X, GRID_H)
    band(GRID_X + GRID_W, GRID_Y, CANVAS_W - GRID_X - GRID_W, GRID_H)

    // Ortam parıltısı: yavaş süzülen altın toz (bantların üstünde, çerçevede
    // altında — hiçbir sembolü kapatmaz)
    this.add
      .particles(0, 0, 'spark', {
        x: { min: 0, max: CANVAS_W },
        y: { min: 0, max: CANVAS_H },
        quantity: 1,
        frequency: 750,
        lifespan: { min: 4500, max: 7500 },
        speedX: { min: -10, max: 10 },
        speedY: { min: -16, max: -4 },
        scale: { min: 0.12, max: 0.45 },
        alpha: { start: 0.5, end: 0 },
        tint: GOLD,
        blendMode: Phaser.BlendModes.ADD,
        emitting: true,
      })
      .setDepth(5.5)

    // Çift altın çerçeve + köşe elmasları
    const frame = this.add.graphics().setDepth(6)
    frame.lineStyle(10, GOLD, 0.06) // dış ışıma (faux glow)
    frame.strokeRect(GRID_X - 10, GRID_Y - 10, GRID_W + 20, GRID_H + 20)
    frame.lineStyle(2, GOLD, 0.5)
    frame.strokeRect(GRID_X - 14, GRID_Y - 14, GRID_W + 28, GRID_H + 28)
    frame.lineStyle(3, GOLD, 1)
    frame.strokeRect(GRID_X, GRID_Y, GRID_W, GRID_H)
    const diamond = (cx: number, cy: number, r: number): void => {
      frame.fillPoints(
        [
          new Phaser.Math.Vector2(cx, cy - r),
          new Phaser.Math.Vector2(cx + r, cy),
          new Phaser.Math.Vector2(cx, cy + r),
          new Phaser.Math.Vector2(cx - r, cy),
        ],
        true,
      )
    }
    const cr = 9
    diamond(GRID_X - 14, GRID_Y - 14, cr)
    diamond(GRID_X + GRID_W + 14, GRID_Y - 14, cr)
    diamond(GRID_X + GRID_W + 14, GRID_Y + GRID_H + 14, cr)
    diamond(GRID_X - 14, GRID_Y + GRID_H + 14, cr)

    // Başlık (sabit) + altın altı çizgi + hafif nabız
    const title = this.add
      .text(CANVAS_W / 2, 58, 'CLOVER LINK BELLS', {
        fontSize: '40px',
        fontFamily: 'Arial, sans-serif',
        fontStyle: 'bold',
        color: '#f5c542',
        stroke: '#5b3a00',
        strokeThickness: 6,
      })
      .setOrigin(0.5)
      .setDepth(20)
    title.setShadow(0, 3, 'rgba(0, 0, 0, 0.6)', 10)
    this.tweens.add({
      targets: title,
      scale: { from: 1, to: 1.025 },
      yoyo: true,
      repeat: -1,
      duration: 1600,
      ease: 'Sine.easeInOut',
    })

    const underline = this.add.graphics().setDepth(19)
    underline.fillStyle(GOLD, 0.65)
    underline.fillRoundedRect(CANVAS_W / 2 - 230, 84, 460, 3, 2)
    diamond(CANVAS_W / 2 - 244, 85, 5)
    diamond(CANVAS_W / 2 + 244, 85, 5)

    // Dinamik banner + kazanç yazısı (arkasında yumuşak ışıma)
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

    this.winGlow = this.add
      .image(CANVAS_W / 2, GRID_Y + GRID_H + 75, 'spark')
      .setScale(14, 5)
      .setAlpha(0)
      .setDepth(19)
      .setBlendMode(Phaser.BlendModes.ADD)

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
    this.winText.setShadow(0, 4, 'rgba(0, 0, 0, 0.7)', 12)

    // Jackpot prize bar (Mini→Grand): makaranın altında sabit ödül sırası.
    // Çipler bet'e orantılı ÇARPAN gösterir; düştüğünde burası parlar.
    this.jackpotChips = JACKPOT_TIERS.map((tier, i) =>
      this.add.image(jackpotChipX(i), JACKPOT_BAR_Y, `jp-${tier}`).setDepth(7),
    )
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
    this.sfx('spin', { volume: 0.55 })
    this.winText.setText('')
    this.tweens.killTweensOf(this.winText)
    this.winText.setScale(1)
    this.tweens.killTweensOf(this.winGlow)
    this.winGlow.setAlpha(0)
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
    this.tweens.killTweensOf(container) // önceki duruş sekmesi
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
          // Duruş "sekmesi" + tık sesi (makaralar sırayla inerken ritim verir)
          this.sfx('reelstop', { volume: 0.45, rate: 0.94 + r * 0.04 })
          this.tweens.add({
            targets: container,
            y: GRID_Y + 7,
            duration: 55,
            yoyo: true,
            ease: 'Quad.easeOut',
            onComplete: () => resolve(),
          })
        },
      })
    })
  }

  private highlightResult(result: SpinResult): void {
    const positions = new Set<string>()
    const lines = CLOVER_LINK_BELLS.lines
    let bellWin = false

    for (const w of result.lineWins) {
      if (w.symbol === 'bell') bellWin = true
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
      // Altın çerçeve parıltısı (kazanç hücresinin altına oturur)
      const { x, y } = cellCenter(r, row)
      const glow = this.add
        .image(x, y, 'glow-cell')
        .setDepth(3)
        .setBlendMode(Phaser.BlendModes.ADD)
      this.highlightGlows.push(glow)
      this.highlightTweens.push(
        this.tweens.add({
          targets: glow,
          alpha: { from: 0.35, to: 1 },
          yoyo: true,
          repeat: -1,
          duration: 420,
        }),
      )
    }

    // Kazançta zil çalar (Clover Link Bells'in imza sesi)
    if (bellWin) this.sfx('bell', { volume: 0.7 })
  }

  private stopHighlight(): void {
    this.highlightTweens.forEach((t) => t.stop())
    this.highlightTweens = []
    this.highlightGlows.forEach((g) => g.destroy())
    this.highlightGlows = []
    for (let r = 0; r < COLS; r++) {
      for (let row = 0; row < ROWS; row++) {
        this.cells[r][row]?.setScale(1)
      }
    }
  }

  private showWin(amount: number, opts: { sound?: boolean } = {}): Promise<void> {
    const bet = useGameStore.getState().bet
    // Kazanç sesi: büyük kazanç fanfarı eşiği (5× bahis)
    // Jackpot düşüşünde fanfar zaten çaldı → opts.sound: false
    if (opts.sound !== false) {
      if (amount >= bet * 5) this.sfx('bigwin', { volume: 0.75 })
      else this.sfx('win', { volume: 0.6 })
    }

    // Kazanç ışıması + altın parıltı patlaması
    this.tweens.killTweensOf(this.winGlow)
    this.winGlow.setAlpha(0)
    this.tweens.add({
      targets: this.winGlow,
      alpha: 0.6,
      duration: 420,
      ease: 'Sine.easeOut',
    })
    this.burst(CANVAS_W / 2, GRID_Y + GRID_H + 75, GOLD)
    if (amount >= bet * 5) this.burst(CANVAS_W / 2, GRID_Y + GRID_H / 2, GOLD)

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

  /// Kazanç anında altın parıltı patlaması (1 sn sonra kendiliğinden söner)
  private burst(x: number, y: number, tint: number): void {
    const em = this.add
      .particles(x, y, 'spark', {
        speed: { min: 140, max: 420 },
        angle: { min: 0, max: 360 },
        gravityY: 620,
        lifespan: 850,
        frequency: -1, // explode modu
        scale: { start: 1.1, end: 0 },
        alpha: { start: 1, end: 0 },
        tint,
        blendMode: Phaser.BlendModes.ADD,
      })
      .setDepth(21)
    em.explode(30, x, y)
    this.time.delayedCall(1000, () => em.destroy())
  }

  /// Grid'de scatter sayımı — ince "parıltı" ipucu sesi için
  private scatterCue(columns: readonly (readonly SymbolId[])[]): void {
    let n = 0
    for (const col of columns) {
      for (const s of col) {
        if (s === CLOVER_LINK_BELLS.scatter.symbol) n++
      }
    }
    if (n > 0) {
      this.sfx('scatter', { volume: n >= 3 ? 0.7 : 0.4 })
    }
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
    if (this.banner.text === text) return
    this.banner.setText(text)
    if (text === '') return
    // Değişimde hafif pop (mesajın "vurması")
    this.banner.setScale(1.25)
    this.tweens.add({
      targets: this.banner,
      scale: 1,
      duration: 240,
      ease: 'Back.easeOut',
    })
  }

  // ────────────────────────────────────────────── bonuslar

  /// Normal spine düşen jackpot: kademe çipi parlar + fanfar + ödül sayımı
  private async playSpinJackpot(hit: JackpotHit): Promise<void> {
    useGameStore.getState().stageWin(hit.win)
    this.sfx('jackpot', { volume: 0.85 })
    this.setBanner(`JACKPOT! ${hit.tier.toUpperCase()}`)

    const chip = this.jackpotChips[JACKPOT_TIERS.indexOf(hit.tier)]
    let flash: Phaser.Tweens.Tween | null = null
    if (chip) {
      this.burst(chip.x, chip.y, GOLD)
      flash = this.tweens.add({
        targets: chip,
        scale: { from: 1, to: 1.18 },
        yoyo: true,
        repeat: 15, // ~2,5 sn — ödül sayımını kapsar
        duration: 160,
      })
    }

    await this.delay(650)
    await this.showWin(hit.win, { sound: false })
    await this.delay(1100)

    flash?.stop()
    chip?.setScale(1)
  }

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
    this.sfx('link', { volume: 0.7 })
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
      this.sfx('jackpot', { volume: 0.8 })
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
      this.scatterCue(fs.result.columns)

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
      this.scatterCue(round.base.columns)

      if (round.base.totalWin > 0) {
        useGameStore.getState().stageWin(round.base.totalWin)
        this.highlightResult(round.base)
        await this.showWin(round.base.totalWin)
        await this.delay(700)
        this.stopHighlight()
      }

      // Jackpot — normal spine düşen kademe (link/FS'den ÖNCE, akış sırası)
      if (round.jackpot) {
        await this.playSpinJackpot(round.jackpot)
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
