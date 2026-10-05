import { NextResponse } from 'next/server'
import { CURRENT_CONFIG_HASH } from '@/lib/server/config-versions'
import { getDb } from '@/lib/server/db'

export interface HealthBody {
  readonly ok: boolean
  readonly db: 'ok' | 'error'
  /// Canlı binary'nin oyun verisi parmak izi (deploy doğrulaması)
  readonly configHash: string
  readonly uptimeSec: number
  readonly error?: string
}

const startedAt = Date.now()

/// Liveness/health — YAZMA YAPMAZ (session açmaz); yük dengeleyici
/// ve yayın sonrası doğrulama için. DB erişilemezse 503.
export async function GET(): Promise<NextResponse<HealthBody>> {
  try {
    getDb().prepare('SELECT 1').get()
    return NextResponse.json({
      ok: true,
      db: 'ok',
      configHash: CURRENT_CONFIG_HASH,
      uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    })
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        db: 'error',
        configHash: CURRENT_CONFIG_HASH,
        uptimeSec: Math.round((Date.now() - startedAt) / 1000),
        error: err instanceof Error ? err.message : 'bilinmeyen hata',
      },
      { status: 503 },
    )
  }
}
