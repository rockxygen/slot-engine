import { NextResponse } from 'next/server'
import { unbindSession } from '@/lib/server/accounts'
import { getDb } from '@/lib/server/db'
import { getOrCreateSessionId } from '@/lib/server/session'

/// Oturumu oyuncudan ayır (bakiye/ledger oturumda KALIR — kimlik ile
/// para ayrıdır; anonim demo akışına döner).
export async function POST(): Promise<NextResponse> {
  try {
    const sessionId = await getOrCreateSessionId()
    unbindSession(getDb(), sessionId)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('çıkış hatası:', err)
    return NextResponse.json(
      { error: 'internal_error', message: 'Çıkış işlenemedi' },
      { status: 500 },
    )
  }
}
