import { create } from 'zustand'
import type { SpinRound } from '@/lib/engine'
import { nextDemoRound } from '@/lib/demo-round'

/// Para minor birimdedir (kuruş) — motorla aynı para birimi.
export function formatMinor(n: number): string {
  return (n / 100).toLocaleString('tr-TR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

export const BET_OPTIONS = [100, 200, 500, 1000] as const
export const START_BALANCE = 50_000 // 500,00 ₺ demo bakiye

/// Sunucu/animasyon durumu — client SADECE durumu gösterir,
/// tur sonucunu asla hesaplamaz (result `round` olarak gelir).
export type Phase = 'idle' | 'spinning' | 'link' | 'freespins'

interface GameState {
  balance: number
  bet: number
  phase: Phase
  /// Sunucudan (demo: yerel motordan) gelen TAM tur
  round: SpinRound | null
  /// Her SPIN'de 1 artar; Phaser sahnesi bunu görünce oynatır
  spinId: number
  /// HUD'da biriken gösterim kazancı (money ≠ display)
  winShown: number
  /// FS sırasında "FREE SPINS 3/13" etiketi
  fsLabel: string | null

  setBet: (bet: number) => void
  spin: () => void
  stageWin: (amount: number) => void
  setPhase: (phase: Phase) => void
  setFsLabel: (label: string | null) => void
  settle: () => void
  refill: () => void
}

export const useGameStore = create<GameState>((set, get) => ({
  balance: START_BALANCE,
  bet: 200,
  phase: 'idle',
  round: null,
  spinId: 0,
  winShown: 0,
  fsLabel: null,

  setBet: (bet) => {
    if (get().phase === 'idle') set({ bet })
  },

  spin: () =>
    set((s) => {
      if (s.phase !== 'idle' || s.balance < s.bet) return {}
      // DEMO kaynağı: turu yerel motor üretir. Faz 3'te bu tek satır
      // `POST /api/spin` çağrısına döner — dönen tip (SpinRound) aynı.
      const round = nextDemoRound(s.bet)
      return {
        balance: s.balance - s.bet,
        round,
        spinId: s.spinId + 1,
        winShown: 0,
        phase: 'spinning' as Phase,
        fsLabel: null,
      }
    }),

  stageWin: (amount) => set((s) => ({ winShown: s.winShown + amount })),

  setPhase: (phase) => set({ phase }),

  setFsLabel: (fsLabel) => set({ fsLabel }),

  settle: () =>
    set((s) => {
      if (s.phase === 'idle') return {} // çift settle koruması (para iki kez eklenmesin)
      return {
        balance: s.balance + (s.round?.totalWin ?? 0),
        phase: 'idle',
        fsLabel: null,
      }
    }),

  refill: () => set({ balance: get().balance + START_BALANCE }),
}))

/// DEBUG: sayfa konsolundan durumu gözlemlemek için (demo/CI smoke testi).
/// Gerçek para modunda bu pencere nesnesi OLMAZ; durum sunucudadır.
if (typeof window !== 'undefined') {
  ;(window as unknown as { __game?: typeof useGameStore }).__game = useGameStore
}
