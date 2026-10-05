import type {
  ApiErrorBody,
  ApiErrorCode,
  AuthResponse,
  KycStatus,
  LimitsResponse,
  LimitsState,
  MeResponse,
  Player,
  SpinForce,
  SpinRequest,
  SpinResponse,
} from './api-types'

/**
 * Sunucu istemcisi — TÜRK istemci veri kaynağıdır.
 *
 * Faz 3: `nextDemoRound` (yerel motor) tamamen KALDIRILDI. Buradan
 * başkası tur üretmez; yerel matematik yoktur.
 */

export class ApiRequestError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'ApiRequestError'
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, init)
  } catch {
    throw new ApiRequestError('internal_error', 'Ağ hatası — tekrar deneyin', 0)
  }

  let data: unknown = null
  try {
    data = await res.json()
  } catch {
    // boş gövde
  }

  if (!res.ok) {
    const body = data as ApiErrorBody | null
    throw new ApiRequestError(
      body?.error ?? 'internal_error',
      body?.message ?? `İstek başarısız (${res.status})`,
      res.status,
    )
  }
  return data as T
}

/// Tur istek kimliği (idempotency): ağ tekrarında aynı tur döner.
export function newClientRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  // non-secure context fallback (uuid v4 aynı biçimde)
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/// QA force parametresi (`/?force=link|fs`) — değeri İSTEMCİDE okunur,
/// ama izni SUNUCUDA (yalnızca demo ortamı açıksa tur gerçekten force'lenir).
export function currentForce(): SpinForce | null {
  if (typeof window === 'undefined') return null
  const f = new URLSearchParams(window.location.search).get('force')
  return f === 'link' || f === 'fs' ? f : null
}

export async function requestSpin(
  bet: number,
  clientRequestId: string,
  force: SpinForce | null,
): Promise<SpinResponse> {
  const body: SpinRequest = { bet, clientRequestId, force }
  return request<SpinResponse>('/api/spin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function fetchBalance(): Promise<number> {
  const data = await request<{ balance: number }>('/api/state')
  return data.balance
}

export async function refillBalance(): Promise<number> {
  const data = await request<{ balance: number }>('/api/demo/refill', {
    method: 'POST',
  })
  return data.balance
}

/// ── Hesap / KYC (Faz 7 UI)

function postJson<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/// Mevcut oturumun oyuncusu (null = anonim demo oturumu)
export async function fetchMe(): Promise<Player | null> {
  const data = await request<MeResponse>('/api/auth/me')
  return data.player
}

export async function registerAccount(
  username: string,
  password: string,
): Promise<Player> {
  const data = await postJson<AuthResponse>('/api/auth/register', {
    username,
    password,
  })
  return data.player
}

export async function loginAccount(
  username: string,
  password: string,
): Promise<Player> {
  const data = await postJson<AuthResponse>('/api/auth/login', {
    username,
    password,
  })
  return data.player
}

export async function logoutAccount(): Promise<void> {
  await postJson<{ ok: true }>('/api/auth/logout', {})
}

/// Demo KYC stub — gerçek entegrasyonda sağlayıcı webhook'u çağırır
export async function requestKyc(status: KycStatus): Promise<Player> {
  const data = await postJson<AuthResponse>('/api/auth/kyc', { status })
  return data.player
}

/// ── Sorumlu oyun limitleri

export async function fetchLimits(): Promise<LimitsResponse> {
  return request<LimitsResponse>('/api/limits')
}

export async function updateLimits(
  patch: Partial<LimitsState>,
): Promise<LimitsResponse> {
  return request<LimitsResponse>('/api/limits', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
}
