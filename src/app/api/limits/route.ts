import { NextResponse } from 'next/server'
import { getDb } from '@/lib/server/db'
import {
  getLimits,
  limitUsage,
  setLimits,
  type SessionLimits,
} from '@/lib/server/limits'
import { getOrCreateSessionId } from '@/lib/server/session'

export interface LimitsResponse {
  readonly limits: SessionLimits
  readonly usage: {
    readonly netLoss: number
    readonly spend: number
    readonly playSeconds: number
  }
}

const LIMIT_KEYS = ['lossLimit', 'spendLimit', 'sessionLimitSec'] as const

/// Limitleri GÖSTER (sorumlu oyun şeffaflığı): değerler + anlık kullanım.
export async function GET(): Promise<NextResponse<LimitsResponse>> {
  const sessionId = await getOrCreateSessionId()
  const db = getDb()
  return NextResponse.json({
    limits: getLimits(db, sessionId),
    usage: limitUsage(db, sessionId),
  })
}

/// Limitleri AYARLA. PATCH: anahtarda varsa güncellenir (null = sınırsız),
/// yoksa korunur. Geçersiz değer → 400. Limit INİŞLERİ anında uygulanır
/// (yükseltmeler de anında — gerçek para ürününde artış gecikmesi ve
/// limit-değişikliği kaydı produção eklenir, bkz. CERTIFICATION §7).
export async function PUT(
  req: Request,
): Promise<NextResponse<LimitsResponse | { error: string; message: string }>> {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json(
      { error: 'invalid_request', message: 'JSON gövdesi okunamadı' },
      { status: 400 },
    )
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return NextResponse.json(
      { error: 'invalid_request', message: 'Gövde bir JSON nesnesi olmalı' },
      { status: 400 },
    )
  }
  const body = raw as Record<string, unknown>
  const patch: Partial<SessionLimits> = {}
  for (const key of LIMIT_KEYS) {
    if (key in body) {
      const v = body[key]
      if (v !== null && typeof v !== 'number') {
        return NextResponse.json(
          {
            error: 'invalid_request',
            message: `${key}: yalnızca tam sayı veya null`,
          },
          { status: 400 },
        )
      }
      patch[key] = v as number | null
    }
  }

  const sessionId = await getOrCreateSessionId()
  const db = getDb()
  try {
    const limits = setLimits(db, sessionId, patch)
    return NextResponse.json({ limits, usage: limitUsage(db, sessionId) })
  } catch (err) {
    // RangeError: doğrulama hatası → 400; beklenmeyen → 500
    const isValidation = err instanceof RangeError
    return NextResponse.json(
      {
        error: isValidation ? 'invalid_request' : 'internal_error',
        message: err instanceof Error ? err.message : 'bilinmeyen hata',
      },
      { status: isValidation ? 400 : 500 },
    )
  }
}
