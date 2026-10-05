'use client'

import { useEffect, useRef } from 'react'

/**
 * Phaser canvas'ını mount eder.
 *
 * `phaser` modülü `window`'a dokunduğu için SADECE dinamik import ile
 * yüklenir → sayfa sorunsuz SSR olur (React StrictMode çift mount'u
 * destroy ile temizlenir).
 */
export function GameCanvas() {
  const parentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    let game: import('phaser').Game | null = null

    void import('@/phaser/createGame')
      .then((m) => {
        if (cancelled || !parentRef.current) return
        game = m.createSlotGame(parentRef.current)
      })
      .catch((err: unknown) => {
        console.error('Phaser başlatılamadı:', err)
      })

    return () => {
      cancelled = true
      if (game) {
        game.destroy(true)
        game = null
      }
    }
  }, [])

  return (
    <div
      ref={parentRef}
      className="aspect-[3/2] w-full max-w-[1080px] overflow-hidden rounded-2xl border border-white/10"
    />
  )
}
