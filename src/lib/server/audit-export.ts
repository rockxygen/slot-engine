import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { CURRENT_CONFIG_HASH } from './config-versions'

/// ────────────────────────── denetim dışa aktarımı / uzak kopya (Faz 7 · §7)
///
/// CERTIFICATION §7: "yerel SQLite → append-only depolama/uzak kopya".
/// Yerel DB tek başına değiştirilebilir (dosya düzenlenebilir); WORM
/// sözü İKİ KOPYA ve aralarındaki TUTARLILIKLA sağlanır:
///
///   1. `buildExport` → hash-zincirli JSONL (her satır prev-hash'i
///      kapsar → satır sırası/ekleme/silme/Değiştirme zinciri KIRAR).
///   2. Bu dosya diske (veya `--ship` ile uzak uç noktaya) yazılır.
///   3. `verifyExport` zinciri yeniden hesaplar; `--verify` ile iki
///      kopya karşılaştırılır — biri değiştirilmişsa yakalanır.
///
/// Not: Zincirin kriptografik imzası (imzalı başlık hash'i) üretimde
/// anahtar yönetimiyle eklenir; şu anki yapı CASUS/BOZULMA tespiti +
/// iki-kopya karşılaştırması içindir (bkz. CERTIFICATION §7).

const GENESIS = '0'.repeat(64)

export interface ExportCounts {
  readonly rounds: number
  readonly ledger: number
}

interface ChainedLine {
  readonly p: string // önceki satırın hash'i
  readonly h: string // sha256(p + JSON(r))
  readonly r: Record<string, unknown>
}

const sha256 = (text: string): string =>
  createHash('sha256').update(text).digest('hex')

function chainLine(prev: string, record: Record<string, unknown>): ChainedLine {
  const h = sha256(prev + JSON.stringify(record))
  return { p: prev, h, r: record }
}

/**
 * Denetim DB'sinden hash-zincirli JSONL üretir (her satır `\n` ile).
 * Satırlar: header (sayımlar + config hash) → rounds (id sırası) →
 * ledger (id sırası). Yalnızca OKUMA yapar.
 */
export function buildExport(db: DatabaseSync): string[] {
  const counts = {
    rounds: (db.prepare('SELECT COUNT(*) c FROM rounds').get() as { c: number }).c,
    ledger: (db.prepare('SELECT COUNT(*) c FROM ledger').get() as { c: number }).c,
  }

  const lines: string[] = []
  let prev = GENESIS

  const push = (record: Record<string, unknown>): void => {
    const line = chainLine(prev, record)
    prev = line.h
    lines.push(JSON.stringify(line))
  }

  push({
    type: 'header',
    version: 1,
    exportedAt: new Date().toISOString(),
    configHash: CURRENT_CONFIG_HASH,
    counts,
  })

  const rounds = db
    .prepare(
      `SELECT id, session_id, client_request_id, seed, bet, win, balance_after,
              round_hash, config_hash, forced, created_at
       FROM rounds ORDER BY id`,
    )
    .all() as unknown as Record<string, unknown>[]
  for (const r of rounds) push({ type: 'round', ...r })

  const ledger = db
    .prepare(
      `SELECT id, session_id, kind, amount, balance_after, round_id, created_at
       FROM ledger ORDER BY id`,
    )
    .all() as unknown as Record<string, unknown>[]
  for (const l of ledger) push({ type: 'ledger', ...l })

  return lines
}

export interface VerifyResult {
  readonly ok: boolean
  readonly lines: number
  readonly countsMatch: boolean
  readonly error?: { readonly line: number; readonly detail: string }
}

/// Zinciri yeniden hesaplayarak doğrular. İlk bozuk satırda durur.
export function verifyExport(text: string): VerifyResult {
  const rawLines = text.split('\n').filter((l) => l.trim() !== '')
  if (rawLines.length === 0) {
    return {
      ok: false,
      lines: 0,
      countsMatch: false,
      error: { line: 0, detail: 'dosya boş' },
    }
  }

  let prev = GENESIS
  let headerCounts: ExportCounts | null = null
  let seenRounds = 0
  let seenLedger = 0
  let headerSeen = 0

  for (let i = 0; i < rawLines.length; i++) {
    let line: ChainedLine
    try {
      line = JSON.parse(rawLines[i]) as ChainedLine
    } catch {
      return {
        ok: false,
        lines: rawLines.length,
        countsMatch: false,
        error: { line: i + 1, detail: 'JSON okunamadı' },
      }
    }
    if (line.p !== prev) {
      return {
        ok: false,
        lines: rawLines.length,
        countsMatch: false,
        error: {
          line: i + 1,
          detail: `zincir kırık — önceki hash uyuşmuyor (satır silinmiş/eklenmiş/değiştirilmiş)`,
        },
      }
    }
    const expected = sha256(line.p + JSON.stringify(line.r))
    if (line.h !== expected) {
      return {
        ok: false,
        lines: rawLines.length,
        countsMatch: false,
        error: { line: i + 1, detail: `hash uyuşmuyor — satır içeriği değiştirilmiş` },
      }
    }
    prev = line.h

    const type = line.r['type']
    if (type === 'header') {
      headerSeen++
      if (headerSeen > 1) {
        return {
          ok: false,
          lines: rawLines.length,
          countsMatch: false,
          error: { line: i + 1, detail: 'ikinci header satırı — yapı bozuk' },
        }
      }
      headerCounts = (line.r['counts'] ?? null) as ExportCounts | null
    } else if (type === 'round') seenRounds++
    else if (type === 'ledger') seenLedger++
    else {
      return {
        ok: false,
        lines: rawLines.length,
        countsMatch: false,
        error: { line: i + 1, detail: `bilinmeyen kayıt türü: ${String(type)}` },
      }
    }
  }

  const countsMatch =
    headerSeen === 1 &&
    headerCounts !== null &&
    headerCounts.rounds === seenRounds &&
    headerCounts.ledger === seenLedger

  if (!countsMatch) {
    return {
      ok: false,
      lines: rawLines.length,
      countsMatch: false,
      error: {
        line: rawLines.length,
        detail: `sayım uyuşmuyor — header ${JSON.stringify(headerCounts)} ama kayıt rounds=${seenRounds} ledger=${seenLedger}`,
      },
    }
  }

  return { ok: true, lines: rawLines.length, countsMatch: true }
}

/**
 * Dışa aktarımı uzak uç noktaya gönder (uzak kopya akışı).
 * 2xx dışındaki yanıt veya ağ hatası → hata fırlatır.
 */
export async function shipExport(url: string, text: string): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-ndjson' },
    body: text,
  })
  if (!res.ok) {
    throw new Error(`uzak kopya gönderilemedi: HTTP ${res.status}`)
  }
}
