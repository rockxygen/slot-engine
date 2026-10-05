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
  | 'rng_unhealthy'
  | 'limit_exceeded'
  | 'kyc_required'
  | 'invalid_credentials'
  | 'username_taken'
  | 'internal_error'

export interface ApiErrorBody {
  error: ApiErrorCode
  message: string
}

/// ── Hesap / KYC sözleşmesi (Faz 7 UI — istemci ↔ sunucu ortak tip)
export type KycStatus = 'pending' | 'verified' | 'rejected'

export interface Player {
  readonly id: string
  readonly username: string
  readonly kycStatus: KycStatus
}

export interface AuthResponse {
  readonly player: Player
}

export interface MeResponse {
  readonly player: Player | null
}

/// ── Sorumlu oyun limitleri sözleşmesi
export interface LimitsState {
  lossLimit: number | null
  spendLimit: number | null
  sessionLimitSec: number | null
}

export interface LimitsUsage {
  readonly netLoss: number
  readonly spend: number
  readonly playSeconds: number
}

export interface LimitsResponse {
  readonly limits: LimitsState
  readonly usage: LimitsUsage
}
