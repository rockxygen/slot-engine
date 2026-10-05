import type { LimitsState } from './api-types'

/// Limit paneli giriş alanları ↔ sunucu minor birimleri.
/// Sunucu sözleşmesi: para minor (kuruş), süre saniye, null = sınırsız.
/// UI dili: ₺ (virgül ondalık, nokta binlik) ve DAKİKA.
/// Saf fonksiyon — testler `limit-input.test.ts` içinde.

export interface ParsedInput {
  readonly ok: boolean
  /// Geçerliyse: minor birim (kuruş) ya da null (boş = sınırsız)
  readonly value: number | null
}

const INVALID: ParsedInput = { ok: false, value: null }

/// "500,50" / "1.500" / "" → 50050 | 150000 | null (sınırsız)
export function parseMinorInput(raw: string): ParsedInput {
  const t = raw.trim().replace(/\s/g, '')
  if (t === '') return { ok: true, value: null } // boş = sınırsız bırak
  // tr-TR: binlik NOKTA grupları (1.500 / 1.500.000), ondalık VIRGÜL (,25).
  // Nokta yalnız binlik olabilir → "1.2.3" / "1.50" gibi belirsizler elenir.
  const m = /^(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d{1,2}))?$/.exec(t)
  if (!m) return INVALID
  const normalized = `${m[1].replace(/\./g, '')}.${m[2] ?? '0'}`
  const minor = Math.round(Number(normalized) * 100)
  if (!Number.isSafeInteger(minor) || minor < 1 || minor > 1_000_000_000) {
    return INVALID
  }
  return { ok: true, value: minor }
}

/// "60" / "1,5" / "" → 3600 | 90 | null (sınırsız) — süre saniyeye çevrilir
export function parseMinuteInput(raw: string): ParsedInput {
  const t = raw.trim().replace(/\s/g, '')
  if (t === '') return { ok: true, value: null }
  const normalized = t.replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return INVALID
  const sec = Math.round(Number(normalized) * 60)
  if (!Number.isSafeInteger(sec) || sec < 1 || sec > 1_000_000_000) {
    return INVALID
  }
  return { ok: true, value: sec }
}

/// 50050 → "500,50" · null → "" (görüntüleme)
export function formatMinorInput(minor: number | null): string {
  if (minor === null) return ''
  return (minor / 100).toLocaleString('tr-TR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

/// 3600 → "60" · 90 → "1,5" · null → ""
export function formatMinuteInput(sec: number | null): string {
  if (sec === null) return ''
  return (sec / 60).toLocaleString('tr-TR', { maximumFractionDigits: 2 })
}

/// Panelin göstereceği anlık limit tablosu (kısa özet satırları)
export function limitSummaryLines(
  limits: LimitsState,
): { readonly label: string; readonly text: string }[] {
  return [
    {
      label: 'Kayıp limiti',
      text: limits.lossLimit === null ? 'Sınırsız' : `${formatMinorInput(limits.lossLimit)} ₺`,
    },
    {
      label: 'Harcama limiti',
      text: limits.spendLimit === null ? 'Sınırsız' : `${formatMinorInput(limits.spendLimit)} ₺`,
    },
    {
      label: 'Oturum süresi',
      text: limits.sessionLimitSec === null ? 'Sınırsız' : `${formatMinuteInput(limits.sessionLimitSec)} dk`,
    },
  ]
}
