import { describe, expect, it } from 'vitest'
import { auditFailed, runAudit } from './audit'
import { openDb } from './db'
import { performSpin } from './spin-service'
import { createSession, refillDemo } from './wallet'

/// Denetim motoru — CI'da koşan kanıt testi:
/// temiz DB temiz rapor verir; bozulan her şey YAKALANIR.

const SESSION = 'audit-sess-1'

function seededDb() {
  const db = openDb(':memory:')
  createSession(db, SESSION)
  // bir avuç gerçek tur (biri bonus aramalı force ile)
  let i = 0
  for (const bet of [100, 200, 500, 200, 1000]) {
    const out = performSpin(db, {
      sessionId: SESSION,
      bet,
      clientRequestId: `audit-req-${String(++i).padStart(8, '0')}`,
      force: i === 2 ? 'link' : null,
      allowForce: i === 2,
    })
    expect(out.ok).toBe(true)
  }
  refillDemo(db, SESSION) // bakiye START'ın altındaysa REFILL izi
  return db
}

describe('audit — denetim motoru', () => {
  it('sağlam DB: tüm bulgular ok', () => {
    const findings = runAudit(seededDb())
    expect(findings.length).toBeGreaterThanOrEqual(4) // R1 + L1 + L2 + L3
    expect(auditFailed(findings)).toBe(false)
    expect(findings.some((f) => f.check === 'R1')).toBe(true)
    expect(findings.some((f) => f.check === 'L3' && f.ok)).toBe(true)
  })

  it('bozulmuş seed (yanlış sonuç) → R1 yakalar', () => {
    const db = seededDb()
    db.prepare('UPDATE rounds SET seed = ? WHERE id = 1').run('bozuk-seed')
    const findings = runAudit(db)
    expect(auditFailed(findings)).toBe(true)
    expect(
      findings.some((f) => f.check === 'R1' && !f.ok && f.detail.includes('#1')),
    ).toBe(true)
  })

  it('config kaydırması → R2 yakalar (değişiklik kontrolü)', () => {
    const db = seededDb()
    db.prepare('UPDATE rounds SET config_hash = ? WHERE id = 1').run('eski-config')
    const findings = runAudit(db)
    expect(findings.some((f) => f.check === 'R2' && !f.ok)).toBe(true)
  })

  it('ledger zinciri kesilirse → L1 yakalar; bakiye oynanırsa → L2 yakalar', () => {
    const db = seededDb()
    // balance_after değerlerinden birini törpüle (zincir kopar ama sum aynı kalabilir)
    db.prepare(
      `UPDATE ledger SET balance_after = balance_after + 1
       WHERE id = (SELECT MIN(id) FROM ledger WHERE kind <> 'OPENING')`,
    ).run()
    const f1 = runAudit(db)
    expect(f1.some((f) => f.check === 'L1' && !f.ok)).toBe(true)

    const db2 = seededDb()
    db2.prepare('UPDATE sessions SET balance = balance + 500 WHERE id = ?').run(SESSION)
    const f2 = runAudit(db2)
    expect(f2.some((f) => f.check === 'L2' && !f.ok)).toBe(true)
    expect(auditFailed(f2)).toBe(true)
  })

  it('BET satırının round bağı kopartılırsa → L3 yakalar', () => {
    const db = seededDb()
    db.prepare(
      `UPDATE ledger SET round_id = NULL WHERE kind = 'BET' AND id =
       (SELECT MIN(id) FROM ledger WHERE kind = 'BET')`,
    ).run()
    const findings = runAudit(db)
    expect(findings.some((f) => f.check === 'L3' && !f.ok)).toBe(true)
  })
})
