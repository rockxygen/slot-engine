import { NextResponse } from 'next/server'
import { getDb } from '@/lib/server/db'
import { telemetryReport, type TelemetryReport } from '@/lib/server/telemetry'

/// Operasyon metrikleri (demo: herkese açık; üretimde ağ geçidi/sınır
/// arkasında tutulur — bkz. docs/DEPLOYMENT.md).
/// "allTime" denetim DB'sinden, "process" bu süreçten türetilir.
export async function GET(): Promise<NextResponse<TelemetryReport>> {
  return NextResponse.json(telemetryReport(getDb()))
}
