import { NextResponse } from 'next/server'
import type { ApiErrorBody, StateResponse } from '@/lib/api-types'
import { getDb } from '@/lib/server/db'
import { getOrCreateSessionId } from '@/lib/server/session'
import { refillDemo } from '@/lib/server/wallet'

/// DEMO yenileme: bakiye START_BALANCE altındaysa eksik kadar REFILL
/// ledger satırıyla tamamlanır (denetim izi düşer).
export async function POST(): Promise<
  NextResponse<StateResponse | ApiErrorBody>
> {
  try {
    const sessionId = await getOrCreateSessionId()
    return NextResponse.json({ balance: refillDemo(getDb(), sessionId) })
  } catch (err) {
    console.error('refill hatası:', err)
    return NextResponse.json(
      { error: 'internal_error', message: 'Sunucu hatası — yenileme olmadı' },
      { status: 500 },
    )
  }
}
