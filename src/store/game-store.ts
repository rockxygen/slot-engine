import { create } from 'zustand'
import {
  ApiRequestError,
  currentForce,
  fetchBalance,
  newClientRequestId,
  refillBalance,
  requestSpin,
} from '@/lib/api-client'
import { ALLOWED_BETS } from '@/lib/api-types'
import type { SpinRound } from '@/lib/engine'

/// Para minor birimdedir (kuruş) — motorla aynı para birimi.
export function formatMinor(n: number): string {
  return (n / 100).toLocaleString('tr-TR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

export const BET_OPTIONS = ALLOWED_BETS

/// Sunucu/animasyon durumu — client SADECE durumu gösterir, matematik yapmaz.
/// Para (balance) sunucudan gelir: `GET /api/state` + `POST /api/spin` yanıtı.
export type Phase = 'idle' | 'spinning' | 'link' | 'freespins'

interface GameState {
  /// Sunucu gerçeği (null = henüz yüklenmedi)
  balance: number | null
  /// Tur sonrası bakiye — sahne `settle()` çağırınca görünür olur
  /// (klasik slot hissi: para, kazanç animasyonunun SONUNDA yürürlüğe girer)
  pendingBalance: number | null
  bet: number
  phase: Phase
  /// Sunucudan gelen TAM tur — istemci bunu yalnızca oynatır
  round: SpinRound | null
  /// Her başarılı spin yanıtında 1 artar; Phaser sahnesi bunu görür
  spinId: number
  /// HUD'da biriken gösterim kazancı (money ≠ display)
  winShown: number
  /// FS sırasında "BEDAVA DÖNÜŞ 3/13" etiketi
  fsLabel: string | null
  /// Sunucu/ağ hata mesajı (ör. "Bakiye yetersiz")
  error: string | null

  setBet: (bet: number) => void
  spin: () => Promise<void>
  stageWin: (amount: number) => void
  setPhase: (phase: Phase) => void
  setFsLabel: (label: string | null) => void
  settle: () => void
  loadBalance: () => Promise<void>
  refill: () => Promise<void>
}

export const useGameStore = create<GameState>((set, get) => ({
  balance: null,
  pendingBalance: null,
  bet: 200,
  phase: 'idle',
  round: null,
  spinId: 0,
  winShown: 0,
  fsLabel: null,
  error: null,

  setBet: (bet) => {
    if (get().phase === 'idle') set({ bet })
  },

  spin: async () => {
    const s = get()
    // Çift tıklama koruması: phase senkron yazılır, await ÖNCESİ kilitlenir
    if (s.phase !== 'idle' || s.balance === null || s.balance < s.bet) return

    set({
      phase: 'spinning',
      error: null,
      round: null,
      pendingBalance: null,
      winShown: 0,
      fsLabel: null,
    })

    try {
      const res = await requestSpin(
        s.bet,
        newClientRequestId(),
        currentForce(),
      )
      // Tur + gerçek bakiye geldi: SAHNEYE tek atomik set
      set({
        round: res.round,
        pendingBalance: res.balance,
        spinId: get().spinId + 1,
      })
    } catch (err) {
      const message =
        err instanceof ApiRequestError
          ? err.message
          : 'Ağ hatası — tur işlenmedi'
      set({ phase: 'idle', round: null, error: message })
      // Sunucu gerçeğiyle eşitle (402 vb. durumlarda doğru bakiye gelsin)
      void get().loadBalance()
    }
  },

  stageWin: (amount) => set((s) => ({ winShown: s.winShown + amount })),

  setPhase: (phase) => set({ phase }),

  setFsLabel: (fsLabel) => set({ fsLabel }),

  settle: () =>
    set((s) => {
      if (s.phase === 'idle') return {} // çift settle koruması
      const next: Partial<GameState> = { phase: 'idle', fsLabel: null }
      if (s.pendingBalance !== null) {
        // Sunucu çoktan ödedi; yalnızca GÖSTERİMİ bu an güncellenir
        next.balance = s.pendingBalance
        next.pendingBalance = null
      }
      return next
    }),

  loadBalance: async () => {
    try {
      set({ balance: await fetchBalance(), error: null })
    } catch (err) {
      set({
        error: err instanceof ApiRequestError ? err.message : 'Bakiye yüklenemedi',
      })
    }
  },

  refill: async () => {
    try {
      set({ balance: await refillBalance(), error: null })
    } catch (err) {
      set({
        error: err instanceof ApiRequestError ? err.message : 'Yenileme başarısız',
      })
    }
  },
}))

/// DEBUG: sayfa konsolundan durumu gözlemlemek için (demo/CI smoke testi).
/// Gerçek para modunda bu pencere nesnesi OLMAZ; durum sunucudadır.
if (typeof window !== 'undefined') {
  ;(window as unknown as { __game?: typeof useGameStore }).__game = useGameStore
}
