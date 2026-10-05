import { create } from 'zustand'
import {
  ApiRequestError,
  currentForce,
  fetchBalance,
  newClientRequestId,
  refillBalance,
  requestSpin,
} from '@/lib/api-client'
import { openPanelForErrorCode } from '@/store/account-store'
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

/// Otomatik dönüş ön ayarları (tur sayısı)
export const AUTO_PRESETS = [10, 25, 50] as const
export type AutoPreset = (typeof AUTO_PRESETS)[number]

const SOUND_KEY = 'slot_sound'

/// Ses tercihi: localStorage'dan okunur. SSR'da pencere yok → varsayılan açık;
/// Phaser sahnesi `create()` içinde (hydration SONRASI) çağırır → uyum sorunu yok.
export function loadSoundPref(): boolean {
  try {
    if (typeof window === 'undefined') return true
    return window.localStorage.getItem(SOUND_KEY) !== '0'
  } catch {
    return true
  }
}

function persistSoundPref(on: boolean): void {
  try {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(SOUND_KEY, on ? '1' : '0')
  } catch {
    // gizli mod / kota — tercih kalıcı olmaz, oyun etkilenmez
  }
}

/// Sunucu/animasyon durumu — client SADECE durumu gösterir, matematik yapmaz.
/// Para (balance) sunucudan gelir: `GET /api/state` + `POST /api/spin` yanıtı.
export type Phase = 'idle' | 'spinning' | 'link' | 'bell' | 'freespins'

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
  /// Otomatik dönüş: null = kapalı, sayı = kalan tur (HUD'dan yönetilir)
  autoRemaining: number | null
  /// Otomatik dönüş ön ayarı (başlangıç 10)
  autoPreset: AutoPreset
  /// Ses açık mı — Phaser sahnesi bunu sound manager mute'una bağlar
  soundOn: boolean

  setBet: (bet: number) => void
  spin: () => Promise<void>
  stageWin: (amount: number) => void
  setPhase: (phase: Phase) => void
  setFsLabel: (label: string | null) => void
  settle: () => void
  loadBalance: () => Promise<void>
  refill: () => Promise<void>
  toggleAuto: () => void
  stopAuto: () => void
  cycleAutoPreset: () => void
  decAuto: () => void
  toggleSound: () => void
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
  autoRemaining: null,
  autoPreset: 10,
  soundOn: true,

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
      // Hata → otomatik dönüş DURUR (limit/KYC paneli açılabilir, tekrar yok)
      set({ phase: 'idle', round: null, error: message, autoRemaining: null })
      // İlgili paneli aç: KYC engeli → giriş, limit engeli → limitler
      if (err instanceof ApiRequestError) openPanelForErrorCode(err.code)
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

  // ── Otomatik dönüş (Faz 8): HUD etkisi tur bitiminde `decAuto` + yeniden
  //    `spin` çağırır; hata/yetersiz bakiye durumunda EFFECT veya spin catch
  //    durdurur (burada yalnızca niyet tutulur — matematik SUNUCUDA).

  toggleAuto: () => {
    const s = get()
    if (s.autoRemaining !== null) {
      set({ autoRemaining: null }) // elle durdur
      return
    }
    set({ autoRemaining: s.autoPreset })
  },

  stopAuto: () => set({ autoRemaining: null }),

  cycleAutoPreset: () => {
    const s = get()
    if (s.autoRemaining !== null) return // çalışırken ön ayar değiştirilemez
    const i = AUTO_PRESETS.indexOf(s.autoPreset)
    set({ autoPreset: AUTO_PRESETS[(i + 1) % AUTO_PRESETS.length] })
  },

  decAuto: () =>
    set((s) => ({
      autoRemaining:
        s.autoRemaining === null ? null : Math.max(0, s.autoRemaining - 1),
    })),

  // ── Ses (Faz 8): Phaser sahnesi `soundOn` → mute bağlar; tercih kalıcı
  toggleSound: () => {
    const next = !get().soundOn
    persistSoundPref(next)
    set({ soundOn: next })
  },
}))

/// DEBUG: sayfa konsolundan durumu gözlemlemek için (demo/CI smoke testi).
/// Gerçek para modunda bu pencere nesnesi OLMAZ; durum sunucudadır.
if (typeof window !== 'undefined') {
  ;(window as unknown as { __game?: typeof useGameStore }).__game = useGameStore
}
