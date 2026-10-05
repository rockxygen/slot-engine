import { NextResponse } from 'next/server'
import {
  bindSessionToPlayer,
  registerPlayer,
} from '@/lib/server/accounts'
import { getDb } from '@/lib/server/db'
import { getOrCreateSessionId } from '@/lib/server/session'
import type { ApiErrorCode } from '@/lib/api-types'

const bad = (error: ApiErrorCode, message: string, status: number) =>
  NextResponse.json({ error, message }, { status })

/**
 * Hesap aç + oturuma bağla (Faz 7 · §7 — gerçek oturum yönetiminin
 * çekirdeği). `kyc_status` yeni hesapta `pending`'tir; doğrulanmamış
 * oyuncu tur oYNAYAMAZ (performSpin `kyc_required`).
 */
export async function POST(req: Request): Promise<NextResponse> {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return bad('invalid_request', 'JSON gövdesi okunamadı', 400)
  }
  const body = raw as { username?: unknown; password?: unknown } | null
  if (
    !body ||
    typeof body.username !== 'string' ||
    typeof body.password !== 'string'
  ) {
    return bad('invalid_request', 'username ve password metin olmalı', 400)
  }

  try {
    const db = getDb()
    const sessionId = await getOrCreateSessionId()
    const player = registerPlayer(db, body.username, body.password)
    bindSessionToPlayer(db, sessionId, player.id)
    return NextResponse.json({ player }, { status: 201 })
  } catch (err) {
    if (err instanceof RangeError) {
      return bad('invalid_request', err.message, 400)
    }
    if (err instanceof Error && err.message === 'Bu kullanıcı adı alınmış') {
      return bad('username_taken', 'Bu kullanıcı adı alınmış', 409)
    }
    console.error('kayıt hatası:', err)
    return bad('internal_error', 'Kayıt işlenemedi', 500)
  }
}
