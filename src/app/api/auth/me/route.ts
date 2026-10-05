import { NextResponse } from 'next/server'
import { sessionPlayer } from '@/lib/server/accounts'
import { getDb } from '@/lib/server/db'
import { getOrCreateSessionId } from '@/lib/server/session'

/**
 * Mevcut oturumun oyuncusu — UI açılışında kullanılır (girişli mi?).
 * Oyuncu yoksa `player: null` (anonim demo oturumu).
 */
export async function GET(): Promise<NextResponse> {
  try {
    const sessionId = await getOrCreateSessionId()
    return NextResponse.json({ player: sessionPlayer(getDb(), sessionId) })
  } catch (err) {
    console.error('me hatası:', err)
    return NextResponse.json(
      { error: 'internal_error', message: 'Oturum okunamadı' },
      { status: 500 },
    )
  }
}
