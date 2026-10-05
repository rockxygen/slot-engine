import { NextResponse } from 'next/server'
import { sessionPlayer, setKycStatus, type KycStatus } from '@/lib/server/accounts'
import { getDb } from '@/lib/server/db'
import { getOrCreateSessionId } from '@/lib/server/session'
import type { ApiErrorCode } from '@/lib/api-types'

const bad = (error: ApiErrorCode, message: string, status: number) =>
  NextResponse.json({ error, message }, { status })

const STATUSES: readonly KycStatus[] = ['pending', 'verified', 'rejected']

/**
 * KYC DURUMU — DEMO STUB'U.
 *
 * Bu endpoint KYC'nin kendisini DEĞİL, kapıyı sınar: gerçek entegrasyonda
 * belgeler kimlik sağlayıcısında incelenir ve sağlayıcının webhook'u
 * `setKycStatus(db, playerId, 'verified')` çağırır. Demo'da QA bu yolla
 * onay/red senaryolarını uçtan uca test eder.
 */
export async function POST(req: Request): Promise<NextResponse> {
  let raw: unknown = null
  try {
    raw = await req.json()
  } catch {
    // gövdesiz istek = 'verified'
  }
  const status =
    raw === null
      ? 'verified'
      : (raw as { status?: unknown }).status
  if (typeof status !== 'string' || !STATUSES.includes(status as KycStatus)) {
    return bad(
      'invalid_request',
      "status: 'pending' | 'verified' | 'rejected' olmalı",
      400,
    )
  }

  try {
    const db = getDb()
    const sessionId = await getOrCreateSessionId()
    const player = sessionPlayer(db, sessionId)
    if (!player) {
      return bad('invalid_request', 'Önce giriş yapın (kayıt/giriş yok)', 400)
    }
    setKycStatus(db, player.id, status as KycStatus)
    return NextResponse.json({
      player: { ...player, kycStatus: status as KycStatus },
    })
  } catch (err) {
    console.error('kyc hatası:', err)
    return bad('internal_error', 'KYC durumu güncellenemedi', 500)
  }
}
