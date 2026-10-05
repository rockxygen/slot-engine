import { NextResponse } from 'next/server'
import type { StateResponse } from '@/lib/api-types'
import { getDb } from '@/lib/server/db'
import { getOrCreateSessionId } from '@/lib/server/session'
import { getBalance } from '@/lib/server/wallet'

/// İstemci açılışta ve hata sonrası BAKİYEYİ buradan okur.
/// Cookie okunduğu için dinamiktir (cache'e girmez).
export async function GET(): Promise<NextResponse<StateResponse>> {
  const sessionId = await getOrCreateSessionId()
  return NextResponse.json({ balance: getBalance(getDb(), sessionId) })
}
