import { create } from 'zustand'
import {
  fetchLimits,
  fetchMe,
  loginAccount,
  logoutAccount,
  registerAccount,
  requestKyc,
  updateLimits,
} from '@/lib/api-client'
import { ApiRequestError } from '@/lib/api-client'
import type {
  KycStatus,
  LimitsState,
  LimitsUsage,
  Player,
} from '@/lib/api-types'

/// Hesap / limit paneli durumu (Faz 7 UI).
/// Sunucu gerçeğini tutar; istemci matematik YAPMAZ, form dönüşümleri
/// `limit-input.ts` içinde saf ve testlidir.

export type Panel = 'closed' | 'account' | 'limits'

interface AccountState {
  player: Player | null
  meLoaded: boolean
  limits: LimitsState | null
  usage: LimitsUsage | null
  panel: Panel
  busy: boolean
  error: string | null
  notice: string | null

  openPanel: (panel: Exclude<Panel, 'closed'>) => void
  closePanel: () => void
  clearFlash: () => void
  refreshAccount: () => Promise<void>
  refreshLimits: () => Promise<void>
  login: (username: string, password: string) => Promise<boolean>
  register: (username: string, password: string) => Promise<boolean>
  logout: () => Promise<void>
  verifyKyc: (status: KycStatus) => Promise<void>
  saveLimits: (patch: Partial<LimitsState>) => Promise<boolean>
}

function errMessage(err: unknown, fallback: string): string {
  return err instanceof ApiRequestError || err instanceof Error
    ? err.message
    : fallback
}

export const useAccountStore = create<AccountState>((set, get) => ({
  player: null,
  meLoaded: false,
  limits: null,
  usage: null,
  panel: 'closed',
  busy: false,
  error: null,
  notice: null,

  openPanel: (panel) => {
    set({ panel, error: null, notice: null })
    // Her açılışta taze veri — panel her zaman sunucu gerçeğini gösterir
    if (panel === 'account') void get().refreshAccount()
    else void get().refreshLimits()
  },

  closePanel: () => set({ panel: 'closed', error: null, notice: null }),

  clearFlash: () => set({ error: null, notice: null }),

  refreshAccount: async () => {
    try {
      set({ player: await fetchMe(), meLoaded: true })
    } catch (err) {
      set({ meLoaded: true, error: errMessage(err, 'Oturum okunamadı') })
    }
  },

  refreshLimits: async () => {
    try {
      const res = await fetchLimits()
      set({ limits: res.limits, usage: res.usage })
    } catch (err) {
      set({ error: errMessage(err, 'Limitler okunamadı') })
    }
  },

  login: async (username, password) => {
    set({ busy: true, error: null, notice: null })
    try {
      const player = await loginAccount(username, password)
      set({ player, meLoaded: true, busy: false, notice: `Hoş geldin, ${player.username}` })
      void get().refreshLimits()
      return true
    } catch (err) {
      set({ busy: false, error: errMessage(err, 'Giriş yapılamadı') })
      return false
    }
  },

  register: async (username, password) => {
    set({ busy: true, error: null, notice: null })
    try {
      const player = await registerAccount(username, password)
      set({
        player,
        meLoaded: true,
        busy: false,
        notice: `Hesap açıldı — KYC belgelerin onay bekliyor`,
      })
      return true
    } catch (err) {
      set({ busy: false, error: errMessage(err, 'Kayıt yapılamadı') })
      return false
    }
  },

  logout: async () => {
    set({ busy: true, error: null, notice: null })
    try {
      await logoutAccount()
      set({ player: null, meLoaded: true, busy: false, notice: 'Çıkış yapıldı' })
    } catch (err) {
      set({ busy: false, error: errMessage(err, 'Çıkış yapılamadı') })
    }
  },

  verifyKyc: async (status) => {
    set({ busy: true, error: null, notice: null })
    try {
      const player = await requestKyc(status)
      set({
        player,
        busy: false,
        notice:
          status === 'verified'
            ? 'KYC onaylandı — oyun açık'
            : status === 'rejected'
              ? 'KYC reddedildi'
              : 'KYC belgeleri beklemeye alındı',
      })
    } catch (err) {
      set({ busy: false, error: errMessage(err, 'KYC durumu güncellenemedi') })
    }
  },

  saveLimits: async (patch) => {
    set({ busy: true, error: null, notice: null })
    try {
      const res = await updateLimits(patch)
      set({ limits: res.limits, usage: res.usage, busy: false, notice: 'Limitler güncellendi' })
      return true
    } catch (err) {
      set({ busy: false, error: errMessage(err, 'Limitler kaydedilemedi') })
      return false
    }
  },
}))

/// Spin hata kodundan ilgili paneli aç (kyc_required → giriş,
/// limit_exceeded → limitler). Oyun akışını durdurmaz, yalnızca yönlendirir.
export function openPanelForErrorCode(code: string): void {
  const store = useAccountStore.getState()
  if (code === 'kyc_required') store.openPanel('account')
  else if (code === 'limit_exceeded') store.openPanel('limits')
}
