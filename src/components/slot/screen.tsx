'use client'

import { Controls, TopBar } from './hud'
import { GameCanvas } from './game-canvas'

export function SlotScreen() {
  return (
    <main className="flex min-h-screen flex-col items-center gap-4 bg-slate-950 p-4 text-white">
      <TopBar />
      <GameCanvas />
      <Controls />
      <p className="max-w-[1080px] text-center text-xs text-slate-500">
        Demo istemci — tur sonucu yerel matematik motorundan gelir. Faz 3&apos;te
        aynı <code className="text-slate-400">SpinRound</code> sözleşmesi
        sunucudan servis edilecek; bu arayüz hiç değişmeyecek.
      </p>
    </main>
  )
}
