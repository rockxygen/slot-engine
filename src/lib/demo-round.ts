import {
  CLOVER_LINK_BELLS,
  createRng,
  playRound,
  randomSeed,
  type SpinRound,
} from '@/lib/engine'

/**
 * DEMO tur kaynağı — şimdilik yerel motoru çağırır.
 *
 * Faz 3'te TEK fonksiyon değişecek:
 *   `return (await fetch('/api/spin', { method:'POST', ... })).json()`
 * Dönen tip aynı kalır (`SpinRound`) → sahne/HUD hiç değişmez.
 * Bu, "sunucu otoriter" mimariye geçişin sigortasıdır.
 */

/// Demo doğrulama aracı: `/?force=link` veya `/?force=fs` açılışta bonus
/// turlarını arar (motor yine kendi geçerli turlarını üretir — matematik
/// DEĞİL, geçerli sonuçlar arasından SEÇİM yapılır). Bu mod istemcide
/// demo amaçlıdır; gerçek para modunda bonusu SUNUCU belirler ve istemci
/// hiç deneme yapmaz. Faz 3 geçişinde bu araç ya taşınır ya da silinir.
type DemoForce = 'link' | 'fs' | null
let force: DemoForce = null

export function configureDemo(search: string): void {
  const f = new URLSearchParams(search).get('force')
  force = f === 'link' || f === 'fs' ? f : null
}

export function nextDemoRound(bet: number): SpinRound {
  if (force) {
    for (let i = 0; i < 4000; i++) {
      const round = playRound(
        CLOVER_LINK_BELLS,
        createRng(`force-${force}-${i}`),
        bet,
      )
      const hit = force === 'link' ? round.link : round.freeSpins
      if (hit) return round
    }
  }
  return playRound(CLOVER_LINK_BELLS, createRng(randomSeed()), bet)
}

if (typeof window !== 'undefined') {
  configureDemo(window.location.search)
}
