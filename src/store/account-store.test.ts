import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openPanelForErrorCode, useAccountStore } from './account-store'

/// Hesap/limit store'u (Faz 7 UI): sunucu gerçeğiyle senkron, hata
/// mesajları API'den gelir; fetch stub'lanır (ağ yok).

const PLAYER = { id: 'p1', username: 'ayse', kycStatus: 'pending' as const }

const LIMITS_OK = {
  limits: { lossLimit: 5000, spendLimit: null, sessionLimitSec: 3600 },
  usage: { netLoss: 100, spend: 300, playSeconds: 60 },
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

/// URL önekine göre yönlendirici: { '/api/auth/login': () => Response }
type Routes = Record<string, () => Response>

function stubFetch(routes: Routes): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async (input: unknown) => {
    const url = String(input)
    const key = Object.keys(routes).find((k) => url.startsWith(k))
    if (!key) throw new Error(`beklenmeyen istek: ${url}`)
    return routes[key]()
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

beforeEach(() => {
  useAccountStore.setState({
    player: null,
    meLoaded: false,
    limits: null,
    usage: null,
    panel: 'closed',
    busy: false,
    error: null,
    notice: null,
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('account-store (Faz 7 UI)', () => {
  it('refreshAccount: /api/auth/me yanıtı player state\'ine geçer', async () => {
    stubFetch({ '/api/auth/me': () => json({ player: PLAYER }) })
    await useAccountStore.getState().refreshAccount()
    const s = useAccountStore.getState()
    expect(s.player?.username).toBe('ayse')
    expect(s.meLoaded).toBe(true)

    stubFetch({ '/api/auth/me': () => json({ player: null }) })
    await useAccountStore.getState().refreshAccount()
    expect(useAccountStore.getState().player).toBeNull()
  })

  it('login: başarı → player + hoş geldin; 401 → hata mesajı, player null', async () => {
    stubFetch({
      '/api/auth/login': () => json({ player: PLAYER }),
      '/api/limits': () => json(LIMITS_OK),
    })
    const ok = await useAccountStore.getState().login('ayse', 'guclu-parola-1')
    expect(ok).toBe(true)
    let s = useAccountStore.getState()
    expect(s.player?.username).toBe('ayse')
    expect(s.notice).toContain('ayse')
    expect(s.busy).toBe(false)

    // ikinci faz: temiz oturumla hatalı giriş
    useAccountStore.setState({ player: null, error: null, notice: null })
    stubFetch({
      '/api/auth/login': () =>
        json(
          { error: 'invalid_credentials', message: 'Kullanıcı adı veya parola hatalı' },
          401,
        ),
      '/api/limits': () => json(LIMITS_OK),
    })
    const bad = await useAccountStore.getState().login('ayse', 'yanlis')
    expect(bad).toBe(false)
    s = useAccountStore.getState()
    expect(s.player).toBeNull()
    expect(s.error).toBe('Kullanıcı adı veya parola hatalı')
    expect(s.busy).toBe(false)
  })

  it('register: 409 username_taken → hata; başarı → KYC notice', async () => {
    stubFetch({
      '/api/auth/register': () =>
        json({ error: 'username_taken', message: 'Bu kullanıcı adı alınmış' }, 409),
    })
    const dup = await useAccountStore.getState().register('ayse', 'guclu-parola-1')
    expect(dup).toBe(false)
    expect(useAccountStore.getState().error).toBe('Bu kullanıcı adı alınmış')

    stubFetch({
      '/api/auth/register': () => json({ player: PLAYER }, 201),
      '/api/limits': () => json(LIMITS_OK),
    })
    const ok = await useAccountStore.getState().register('ayse', 'guclu-parola-1')
    expect(ok).toBe(true)
    expect(useAccountStore.getState().notice).toContain('KYC')
  })

  it('verifyKyc: yanıt oyuncuyu günceller (pending → verified)', async () => {
    useAccountStore.setState({ player: PLAYER })
    stubFetch({
      '/api/auth/kyc': () =>
        json({ player: { ...PLAYER, kycStatus: 'verified' } }),
    })
    await useAccountStore.getState().verifyKyc('verified')
    const s = useAccountStore.getState()
    expect(s.player?.kycStatus).toBe('verified')
    expect(s.notice).toContain('oyun açık')
  })

  it('saveLimits: success → limits+usage güncellenir; 400 → hata, false', async () => {
    stubFetch({ '/api/limits': () => json(LIMITS_OK) })
    const ok = await useAccountStore.getState().saveLimits({ lossLimit: 5000 })
    expect(ok).toBe(true)
    let s = useAccountStore.getState()
    expect(s.limits?.lossLimit).toBe(5000)
    expect(s.notice).toBe('Limitler güncellendi')

    stubFetch({
      '/api/limits': () =>
        json({ error: 'invalid_request', message: 'lossLimit: 0 geçersiz' }, 400),
    })
    const bad = await useAccountStore.getState().saveLimits({ lossLimit: 0 })
    expect(bad).toBe(false)
    s = useAccountStore.getState()
    expect(s.error).toBe('lossLimit: 0 geçersiz')
    expect(s.busy).toBe(false)
  })

  it('openPanel: hesap → hesap paneli + taze me; limitler → limit paneli + taze limit', async () => {
    const fetchFn = stubFetch({
      '/api/auth/me': () => json({ player: null }),
      '/api/limits': () => json(LIMITS_OK),
    })

    useAccountStore.getState().openPanel('account')
    expect(useAccountStore.getState().panel).toBe('account')
    await vi.waitFor(() =>
      expect(useAccountStore.getState().meLoaded).toBe(true),
    )

    useAccountStore.getState().openPanel('limits')
    expect(useAccountStore.getState().panel).toBe('limits')
    await vi.waitFor(() =>
      expect(useAccountStore.getState().limits).not.toBeNull(),
    )
    expect(fetchFn).toHaveBeenCalled()
  })

  it('openPanelForErrorCode: kyc_required → hesap, limit_exceeded → limitler, diğeri → dokunmaz', async () => {
    stubFetch({
      '/api/auth/me': () => json({ player: null }),
      '/api/limits': () => json(LIMITS_OK),
    })

    openPanelForErrorCode('kyc_required')
    expect(useAccountStore.getState().panel).toBe('account')

    useAccountStore.getState().closePanel()
    openPanelForErrorCode('limit_exceeded')
    expect(useAccountStore.getState().panel).toBe('limits')

    useAccountStore.getState().closePanel()
    openPanelForErrorCode('insufficient_balance')
    expect(useAccountStore.getState().panel).toBe('closed')
  })
})
