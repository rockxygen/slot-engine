import type {
  ApiErrorBody,
  ApiErrorCode,
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
