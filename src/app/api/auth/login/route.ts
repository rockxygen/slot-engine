import { NextResponse } from 'next/server'
import { authenticate, bindSessionToPlayer } from '@/lib/server/accounts'
import { getDb } from '@/lib/server/db'
import { getOrCreateSessionId } from '@/lib/server/session'
import type { ApiErrorCode } from '@/lib/api-types'

const bad = (error: ApiErrorCode, message: string, status: number) =>
  NextResponse.json({ error, message }, { status })

/// Kullanıcı adı + parola ile giriş → mevcut oturumu oyuncuya bağlar.
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
    const player = authenticate(db, body.username, body.password)
    if (!player) {
      return bad('invalid_credentials', 'Kullanıcı adı veya parola hatalı', 401)
    }
    const sessionId = await getOrCreateSessionId()
    bindSessionToPlayer(db, sessionId, player.id)
    return NextResponse.json({ player })
  } catch (err) {
    console.error('giriş hatası:', err)
    return bad('internal_error', 'Giriş işlenemedi', 500)
  }
}
