import type { SpinRound } from './engine'

/// İstemci ↔ sunucu sözleşmesi. Faz 3'ten sonra tur sonucu SADECE buradan
/// gelir; istemci motora hiç dokunmaz.

/// Bahis seçenekleri (minor birim) — sunucu DA bu listeden doğrular.
export const ALLOWED_BETS = [100, 200, 500, 1000] as const

export type SpinForce = 'link' | 'fs'

export interface SpinRequest {
  bet: number
  /// İdempotency anahtarı: ağ tekrarında AYNI tur döner, ikinci bahis çekilmez
  clientRequestId: string
  /// Yalnızca demo/QA: bonus turlu turu sunucuda arar (kapısı sunucuda)
  force?: SpinForce | null
}

export interface SpinResponse {
  round: SpinRound
  /// Tur sonrası gerçek bakiye (BET çekilmiş + WIN ödenmiş)
  balance: number
  roundId: number
}

export interface StateResponse {
  balance: number
}

export type ApiErrorCode =
  | 'invalid_request'
  | 'invalid_bet'
  | 'insufficient_balance'
  | 'request_conflict'
  | 'force_not_allowed'
  | 'internal_error'

export interface ApiErrorBody {
  error: ApiErrorCode
  message: string
}
