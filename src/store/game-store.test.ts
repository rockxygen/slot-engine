import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ApiRequestError,
  requestSpin,
} from '@/lib/api-client'
import { CLOVER_LINK_BELLS, createRng, playRound } from '@/lib/engine'
import { useGameStore } from './game-store'

/// Oyun store'u (Faz 8): otomatik dönüş akışı + ses tercihi + hata durumunda
/// otomatik durdurma. Ağ SADECE `requestSpin` üzerinden; fetch stub'lanır.

// `@/lib/api-client`'in ağır olmayan parçaları gerçek kalsın (ApiRequestError
// instanceof için), yalnızca spin/işlevsel yardımcılar mock'lanır.
vi.mock('@/lib/api-client', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/api-client')>()
  return {
    ...orig,
    requestSpin: vi.fn(),
    currentForce: () => null,
    newClientRequestId: () => 'req-test-1',
    fetchBalance: vi.fn(async () => 50000),
    refillBalance: vi.fn(async () => 50000),
  }
})

const round = () => playRound(CLOVER_LINK_BELLS, createRng('store-t'), 200)

beforeEach(() => {
  useGameStore.setState({
    balance: 50000,
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
  })
  vi.mocked(requestSpin).mockReset()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('otomatik dönüş (Faz 8)', () => {
  it('toggleAuto: kapalı → ön ayarla başlar; tekrar → elle durur', () => {
    const s = () => useGameStore.getState()
    expect(s().autoRemaining).toBeNull()

    s().toggleAuto()
    expect(s().autoRemaining).toBe(10) // autoPreset başlangıç 10

    s().toggleAuto() // elle durdur
    expect(s().autoRemaining).toBeNull()
  })

  it('cycleAutoPreset: 10 → 25 → 50 → 10; çalışırken değiştirilemez', () => {
    const s = () => useGameStore.getState()
    s().cycleAutoPreset()
    expect(s().autoPreset).toBe(25)
    s().cycleAutoPreset()
    expect(s().autoPreset).toBe(50)
    s().cycleAutoPreset()
    expect(s().autoPreset).toBe(10)

    s().toggleAuto() // çalışırken
    s().cycleAutoPreset()
    expect(s().autoPreset).toBe(10) // dokunulmadı
    expect(s().autoRemaining).toBe(10)
  })

  it('decAuto: azalır, 0\'ın altına inmez, null kalır', () => {
    const s = () => useGameStore.getState()
    s().toggleAuto()
    s().decAuto()
    s().decAuto()
    expect(s().autoRemaining).toBe(8)
    s().decAuto()
    s().decAuto()
    s().decAuto()
    s().decAuto()
    s().decAuto()
    s().decAuto()
    s().decAuto()
    s().decAuto() // 8 → 0
    expect(s().autoRemaining).toBe(0)
    s().decAuto()
    expect(s().autoRemaining).toBe(0) // taban
    s().stopAuto()
    s().decAuto()
    expect(s().autoRemaining).toBeNull() // null'da no-op
  })

  it('spin hatasında otomatik dönüş durur (limit/KYC/ağ)', async () => {
    vi.mocked(requestSpin).mockRejectedValueOnce(
      new ApiRequestError('limit_exceeded', 'Limit aşıldı', 403),
    )
    const s = () => useGameStore.getState()
    s().toggleAuto()
    expect(s().autoRemaining).toBe(10)

    await s().spin()

    expect(s().autoRemaining).toBeNull() // catch → stopAuto
    expect(s().phase).toBe('idle')
    expect(requestSpin).toHaveBeenCalledTimes(1)
  })

  it('başarılı spin turu setler ve settle bakiyeyi görünür kılar', async () => {
    const r = round()
    vi.mocked(requestSpin).mockResolvedValueOnce({
      round: r,
      balance: 49800,
    } as Awaited<ReturnType<typeof requestSpin>>)
    const s = () => useGameStore.getState()
    await s().spin()

    expect(s().spinId).toBe(1)
    expect(s().round).toEqual(r)
    expect(s().pendingBalance).toBe(49800)
    expect(s().balance).toBe(50000) // henüz görünür değil

    s().settle()
    expect(s().phase).toBe('idle')
    expect(s().balance).toBe(49800)
    expect(s().pendingBalance).toBeNull()
  })
})

describe('ses tercihi (Faz 8)', () => {
  it('toggleSound: durumu çevirir ve localStorage\'a yazar (yoksa sessiz)', () => {
    const s = () => useGameStore.getState()
    expect(s().soundOn).toBe(true)
    s().toggleSound()
    expect(s().soundOn).toBe(false)
    s().toggleSound()
    expect(s().soundOn).toBe(true) // yazma hatası yutulur, durum döner
  })
})
