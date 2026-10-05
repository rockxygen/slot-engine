import Phaser from 'phaser'
import { BG_CSS, CANVAS_H, CANVAS_W } from './layout'
import { GameScene } from './scenes/GameScene'

/**
 * Phaser oyununu DOM'a yerleştirir.
 *
 * NOT: Bu modül SADECE istemcide (useEffect içinden dinamik import ile)
 * yüklenir — SSR'da `window` erişimi olmaz.
 */
export function createSlotGame(parent: HTMLElement): Phaser.Game {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: CANVAS_W,
    height: CANVAS_H,
    backgroundColor: BG_CSS,
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    scene: GameScene,
    banner: false,
  })

  /// DEBUG: smoke test'in oyun döngüsünü dondurup temiz kare
  /// alabilmesi için (headless'ta screenshot timing'i bozabiliyor).
  /// Gerçek para modunda bu pencere nesnesi OLMAZ.
  if (typeof window !== 'undefined') {
    ;(window as unknown as { __phaser?: Phaser.Game }).__phaser = game
  }

  return game
}
