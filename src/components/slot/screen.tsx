'use client'

import { useEffect } from 'react'
import { useGameStore } from '@/store/game-store'
import { Controls, TopBar } from './hud'
import { GameCanvas } from './game-canvas'

export function SlotScreen() {
  // Açılışta bakiye SUNUCUDAN okunur (oto-refresh / yenileme sonrası kalıcı)
  useEffect(() => {
    void useGameStore.getState().loadBalance()
  }, [])

  return (
    <main className="flex min-h-screen flex-col items-center gap-4 bg-slate-950 p-4 text-white">
      <TopBar />
      <GameCanvas />
      <Controls />
      <p className="max-w-[1080px] text-center text-xs text-slate-500">
        Otoriter demo: tur <code className="text-slate-400">POST /api/spin</code>{" "}
        ile sunucuda üretilir, cüzdana BET/WIN ledger olarak yazılır — sayfa
        yenilense de bakiye kalıcıdır. İstemcide matematik yoktur.
      </p>
    </main>
  )
}
