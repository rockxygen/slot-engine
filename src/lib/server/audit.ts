import { openDb } from './db'
import {
  CURRENT_CONFIG_HASH,
  replayRound,
  roundHash,
  type RoundRow,
} from './spin-service'
import { listLedger } from './wallet'
import type { DatabaseSync } from 'node:sqlite'

/// Denetim bulgusu — CLI raporlar, test doğrular.
export interface Finding {
  readonly check: 'R1' | 'R2' | 'L1' | 'L2' | 'L3'
  readonly ok: boolean
  readonly detail: string
}

/**
 * Denetim motoru (aracı CLI'dan bağımsız — CI'da test edilir).
 *
 * Kontroller:
 *   R1  replay: seed → playRound → sha256(round) === round_hash
 *   R2  config sürümü: round'ın config_hash'ı bu BİNARİN config'iyle
 *       aynı mı? (Değişmişse eski config gerekir → FAIL = değişiklik kontrolü)
 *   L1  ledger zinciri: her satırda balance_after = bir önceki + amount
 *   L2  invariant: oturumda SUM(amount) === balance (açılış dahil)
 *   L3  bağ: BET/WIN satırları kendi oturumundaki round'a bağlı
 */
export function runAudit(db: DatabaseSync): Finding[] {
  const findings: Finding[] = []

  // ── R1 + R2: round replay + config sürümü
  const rounds = db
    .prepare('SELECT * FROM rounds ORDER BY id')
    .all() as unknown as RoundRow[]

  let replayed = 0
  for (const r of rounds) {
    if (r.config_hash !== CURRENT_CONFIG_HASH) {
      findings.push({
        check: 'R2',
        ok: false,
        detail: `round #${r.id}: config değişmiş (${r.config_hash.slice(0, 12)}… ≠ ${CURRENT_CONFIG_HASH.slice(0, 12)}…) — yeniden oynatma için eski config gerekir`,
      })
      continue
    }
    const replayedHash = roundHash(replayRound(r.seed, r.bet))
    if (replayedHash !== r.round_hash) {
      findings.push({
        check: 'R1',
        ok: false,
        detail: `round #${r.id}: hash MISMATCH (${replayedHash.slice(0, 12)}… ≠ ${r.round_hash.slice(0, 12)}…) seed="${r.seed}" bet=${r.bet}`,
      })
    } else {
      replayed++
    }
  }
  findings.push({
    check: 'R1',
    ok: true,
    detail: `${replayed}/${rounds.length} round seed'den birebir yeniden üretildi`,
  })

  // ── L1 + L2: oturum bazlı ledger zinciri + invariant
  const sessions = db
    .prepare('SELECT id, balance FROM sessions ORDER BY created_at')
    .all() as unknown as { id: string; balance: number }[]

  for (const s of sessions) {
    const rows = listLedger(db, s.id)
    let running = 0
    let chainBreak: string | null = null
    for (const row of rows) {
      running += row.amount
      if (row.balance_after !== running && !chainBreak) {
        chainBreak = `satır #${row.id}: balance_after=${row.balance_after} ≠ beklenen ${running}`
      }
    }
    findings.push({
      check: 'L1',
      ok: chainBreak === null,
      detail: `oturum ${s.id.slice(0, 8)}: ${rows.length} satır${chainBreak ? ` — ${chainBreak}` : ' zinciri kesintisiz'}`,
    })
    findings.push({
      check: 'L2',
      ok: running === s.balance,
      detail: `oturum ${s.id.slice(0, 8)}: SUM(amount)=${running} ${running === s.balance ? '===' : '≠'} balance=${s.balance}`,
    })
  }

  // ── L3: BET/WIN ↔ round bağları
  const orphan = db
    .prepare(
      `SELECT COUNT(*) c FROM ledger l
       WHERE l.kind IN ('BET','WIN') AND (l.round_id IS NULL
         OR NOT EXISTS (SELECT 1 FROM rounds r WHERE r.id = l.round_id AND r.session_id = l.session_id))`,
    )
    .get() as { c: number }
  findings.push({
    check: 'L3',
    ok: orphan.c === 0,
    detail:
      orphan.c === 0
        ? "tüm BET/WIN satırları kendi oturumundaki round'a bağlı"
        : `${orphan.c} bağ eksik/yanlış round'a işaret ediyor`,
  })

  return findings
}

export function auditFailed(findings: readonly Finding[]): boolean {
  return findings.some((f) => !f.ok)
}

/// Tek dosyada denetim (test/DI yardımcıları)
export function auditFile(path: string): Finding[] {
  return runAudit(openDb(path))
}
