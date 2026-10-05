import { NextResponse } from 'next/server'
import type {
  ApiErrorBody,
  ApiErrorCode,
  SpinForce,
  SpinRequest,
  SpinResponse,
} from '@/lib/api-types'
import { getDb } from '@/lib/server/db'
import { performSpin, type SpinFailureReason } from '@/lib/server/spin-service'
import { getOrCreateSessionId } from '@/lib/server/session'
import { recordReject, recordSpin } from '@/lib/server/telemetry'

function fail(
  status: number,
  error: ApiErrorCode,
  message: string,
): NextResponse<ApiErrorBody> {
  return NextResponse.json({ error, message }, { status })
}

const FORCE_VALUES: readonly SpinForce[] = ['link', 'fs']

function parseBody(raw: unknown): SpinRequest | null {
  if (typeof raw !== 'object' || raw === null) return null
  const body = raw as Partial<SpinRequest>
  if (typeof body.bet !== 'number') return null
  if (
    typeof body.clientRequestId !== 'string' ||
    body.clientRequestId.length < 8 ||
    body.clientRequestId.length > 64
  ) {
    return null
  }
  if (
    body.force !== undefined &&
    body.force !== null &&
    !FORCE_VALUES.includes(body.force as SpinForce)
  ) {
    return null
  }
  return {
    bet: body.bet,
    clientRequestId: body.clientRequestId,
    force: (body.force as SpinForce | undefined) ?? null,
  }
}

/**
 * OTORİTER SPIN — paranın tek kapısı.
 *
 * Akış (hepsi senkron, `src/lib/server/spin-service.ts` içinde transaction):
 * doğrula → idempotency → BET çek → motoru çalıştır → round kaydet → WIN öde.
 * İstemci yalnızca dönen `SpinRound`'ı oynatır.
 *
 * Demo force kapısı (`?force=`): development'ta açık, production'da yalnızca
 * `SLOT_ALLOW_FORCE=1` ile — gerçek para modunda KAPALI.
 */
export async function POST(
  req: Request,
): Promise<NextResponse<SpinResponse | ApiErrorBody>> {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return fail(400, 'invalid_request', 'Geçersiz JSON gövdesi')
  }

  const body = parseBody(raw)
  if (!body) {
    recordReject('invalid_request')
    return fail(
      400,
      'invalid_request',
      'bet / clientRequestId / force alanları geçersiz',
    )
  }

  try {
    const sessionId = await getOrCreateSessionId()
    const outcome = performSpin(getDb(), {
      sessionId,
      bet: body.bet,
      clientRequestId: body.clientRequestId,
      force: body.force ?? null,
      allowForce:
        process.env.NODE_ENV !== 'production' ||
        process.env.SLOT_ALLOW_FORCE === '1',
    })

    if (!outcome.ok) {
      const map: Record<SpinFailureReason, [number, ApiErrorCode, string]> = {
        invalid_bet: [400, 'invalid_bet', 'Bahis izinli listesinde değil'],
        insufficient_balance: [402, 'insufficient_balance', 'Bakiye yetersiz'],
        request_conflict: [
          409,
          'request_conflict',
          'Bu istek kimliği farklı bahisle kullanılmış',
        ],
        force_not_allowed: [
          403,
          'force_not_allowed',
          'Demo force modu bu ortamda kapalı',
        ],
      }
      const [status, error, message] = map[outcome.reason]
      recordReject(error)
      return fail(status, error, message)
    }

    recordSpin({
      bet: body.bet,
      win: outcome.round.totalWin,
      hasLink: outcome.round.link !== null,
      hasFs: outcome.round.freeSpins !== null,
    })
    return NextResponse.json({
      round: outcome.round,
      balance: outcome.balance,
      roundId: outcome.roundId,
    })
  } catch (err) {
    console.error('spin hatası:', err)
    recordReject('internal_error')
    return fail(500, 'internal_error', 'Sunucu hatası — tur işlenmedi')
  }
}
