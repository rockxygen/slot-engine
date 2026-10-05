import type { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { CLOVER_LINK_BELLS } from '@/lib/engine'
import {
  listRounds,
  performSpin,
  replayRound,
  roundHash,
  verifyRound,
} from './spin-service'
import { openDb } from './db'
import {
  createSession,
  getBalance,
  ledgerSum,
  listLedger,
  refillDemo,
  START_BALANCE,
} from './wallet'

const SESSION = 'sess-test-0001'

function setup(balance: number = START_BALANCE): {
  db: DatabaseSync
  sid: string
} {
  const db = openDb(':memory:')
  createSession(db, SESSION, balance)
  return { db, sid: SESSION }
}

let seq = 0
const nextReqId = (): string => `req-id-${String(++seq).padStart(8, '0')}`

describe('performSpin — otoriter tur', () => {
  it('başarılı tur: BET çekilir, WIN ödenir, bakiye = başlangıç - bet + win', () => {
    const { db, sid } = setup()
    const out = performSpin(db, {
      sessionId: sid,
      bet: 200,
      clientRequestId: nextReqId(),
    })
    expect(out.ok).toBe(true)
    if (!out.ok) return

    expect(out.balance).toBe(START_BALANCE - 200 + out.round.totalWin)
    expect(getBalance(db, sid)).toBe(out.balance)

    const ledger = listLedger(db, sid)
    const betRow = ledger.find((r) => r.kind === 'BET')
    expect(betRow).toBeDefined()
    if (!betRow) return
    expect(betRow.amount).toBe(-200)
    expect(betRow.balance_after).toBe(START_BALANCE - 200)
    expect(betRow.round_id).toBe(out.roundId)

    if (out.round.totalWin > 0) {
      const win = ledger.find((r) => r.kind === 'WIN')
      expect(win).toBeDefined()
      expect(win?.amount).toBe(out.round.totalWin)
      expect(win?.round_id).toBe(out.roundId)
    }

    // Denetim invariantı: hareket toplamı == bakiye
    expect(ledgerSum(db, sid)).toBe(getBalance(db, sid))
  })

  it('yetersiz bakiye: hiçbir iz bırakmaz (ne ledger ne round)', () => {
    const { db, sid } = setup(150)
    const out = performSpin(db, {
      sessionId: sid,
      bet: 200,
      clientRequestId: nextReqId(),
    })
    expect(out).toEqual({ ok: false, reason: 'insufficient_balance' })
    expect(getBalance(db, sid)).toBe(150)
    expect(listLedger(db, sid).filter((r) => r.kind !== 'OPENING')).toHaveLength(0)
    expect(listRounds(db, sid)).toHaveLength(0)
  })

  it('geçersiz bahis: listede olmayan veya kesirli tutar reddedilir', () => {
    const { db, sid } = setup()
    for (const bet of [150, 1.5, -200, 0, NaN, Infinity]) {
      const out = performSpin(db, {
        sessionId: sid,
        bet,
        clientRequestId: nextReqId(),
      })
      expect(out).toEqual({ ok: false, reason: 'invalid_bet' })
    }
    expect(listLedger(db, sid).filter((r) => r.kind !== 'OPENING')).toHaveLength(0)
  })
})

describe('idempotency — ağ tekrarında ikinci bahis çekilmez', () => {
  it('aynı (session, request) → aynı tur, bakiye değişmez', () => {
    const { db, sid } = setup()
    const id = nextReqId()
    const a = performSpin(db, { sessionId: sid, bet: 200, clientRequestId: id })
    expect(a.ok).toBe(true)
    const balanceAfter = getBalance(db, sid)

    const b = performSpin(db, { sessionId: sid, bet: 200, clientRequestId: id })
    expect(b.ok).toBe(true)
    if (!a.ok || !b.ok) return

    expect(roundHash(b.round)).toBe(roundHash(a.round))
    expect(b.roundId).toBe(a.roundId)
    expect(getBalance(db, sid)).toBe(balanceAfter) // tek bahis çekildi
    expect(listRounds(db, sid)).toHaveLength(1)
    expect(listLedger(db, sid).filter((r) => r.kind === 'BET')).toHaveLength(1)
  })

  it('aynı request + FARKLI bahis → request_conflict', () => {
    const { db, sid } = setup()
    const id = nextReqId()
    expect(
      performSpin(db, { sessionId: sid, bet: 200, clientRequestId: id }).ok,
    ).toBe(true)

    const c = performSpin(db, { sessionId: sid, bet: 500, clientRequestId: id })
    expect(c).toEqual({ ok: false, reason: 'request_conflict' })
    expect(listRounds(db, sid)).toHaveLength(1)
  })
})

describe('force (demo QA kapısı)', () => {
  it('kapalıyken force reddedilir', () => {
    const { db, sid } = setup()
    const out = performSpin(db, {
      sessionId: sid,
      bet: 200,
      clientRequestId: nextReqId(),
      force: 'link',
      allowForce: false,
    })
    expect(out).toEqual({ ok: false, reason: 'force_not_allowed' })
    expect(listLedger(db, sid).filter((r) => r.kind !== 'OPENING')).toHaveLength(0)
  })

  it('açıkken link turlu tur döner ve kayıtta forced işareti durur', () => {
    const { db, sid } = setup()
    const out = performSpin(db, {
      sessionId: sid,
      bet: 200,
      clientRequestId: nextReqId(),
      force: 'link',
      allowForce: true,
    })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.round.link).not.toBeNull()
    expect(listRounds(db, sid)[0].forced).toBe('link')
  })

  it('açıkken jackpot düşüşlü tur döner: kademe tabloda, ödül bet orantılı', () => {
    const { db, sid } = setup()
    const bet = 200
    const out = performSpin(db, {
      sessionId: sid,
      bet,
      clientRequestId: nextReqId(),
      force: 'jackpot',
      allowForce: true,
    })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.round.jackpot).not.toBeNull()
    const rule = CLOVER_LINK_BELLS.jackpot.tiers[out.round.jackpot!.tier]
    expect(rule).toBeDefined()
    expect(out.round.jackpot!.win).toBe(bet * rule.multiplier)
    expect(listRounds(db, sid)[0].forced).toBe('jackpot')
  })
})

describe('denetim — seed replay', () => {
  it('kayıtlı seed turu birebir yeniden üretir; hash eşleşir', () => {
    const { db, sid } = setup()
    const ids = [nextReqId(), nextReqId(), nextReqId()]
    for (const clientRequestId of ids) {
      const out = performSpin(db, {
        sessionId: sid,
        bet: 200,
        clientRequestId,
      })
      expect(out.ok).toBe(true)
      if (!out.ok) continue

      const v = verifyRound(db, out.roundId)
      expect(v.ok).toBe(true)
      expect(v.row).not.toBeNull()
      if (!v.row) continue

      const replayed = replayRound(v.row.seed, v.row.bet)
      expect(roundHash(replayed)).toBe(v.row.round_hash)
      expect(replayed.totalWin).toBe(v.row.win)
    }
  })

  it('bozulmuş hash denetimde yakalanır', () => {
    const { db, sid } = setup()
    const out = performSpin(db, {
      sessionId: sid,
      bet: 200,
      clientRequestId: nextReqId(),
    })
    expect(out.ok).toBe(true)
    if (!out.ok) return

    db.prepare('UPDATE rounds SET round_hash = ? WHERE id = ?').run(
      'bozuk-hash',
      out.roundId,
    )
    expect(verifyRound(db, out.roundId).ok).toBe(false)
  })
})

describe('ledger invariantı — seri oyun', () => {
  it('50 tur sonra SUM(amount) == bakiye ve balance_after zinciri kırılmaz', () => {
    const { db, sid } = setup()
    const bets = [100, 200, 500, 1000, 100]
    let expected = START_BALANCE

    for (let i = 0; i < 50; i++) {
      const bet = bets[i % bets.length]
      const out = performSpin(db, {
        sessionId: sid,
        bet,
        clientRequestId: nextReqId(),
      })
      if (!out.ok) throw new Error(`tur ${i} başarısız: ${out.reason}`)
      expected += -bet + out.round.totalWin
    }

    expect(getBalance(db, sid)).toBe(expected)
    expect(ledgerSum(db, sid)).toBe(expected)

    // Her satırın balance_after'ı bir öncekinin devamıdır (OPENING'den başlayarak)
    let running = 0
    for (const row of listLedger(db, sid)) {
      running += row.amount
      expect(row.balance_after).toBe(running)
    }
    expect(running).toBe(expected)
  })
})

describe('refill (demo)', () => {
  it('altındaysa eksik kadar REFILL yazar, üstünde dokunmaz', () => {
    const { db, sid } = setup(1_000)
    expect(refillDemo(db, sid)).toBe(START_BALANCE)
    expect(getBalance(db, sid)).toBe(START_BALANCE)

    const refills = listLedger(db, sid).filter((r) => r.kind === 'REFILL')
    expect(refills).toHaveLength(1)
    expect(refills[0].amount).toBe(START_BALANCE - 1_000)
    expect(ledgerSum(db, sid)).toBe(START_BALANCE)

    // tekrar → değişiklik yok, ikinci satır yok
    expect(refillDemo(db, sid)).toBe(START_BALANCE)
    expect(
      listLedger(db, sid).filter((r) => r.kind === 'REFILL'),
    ).toHaveLength(1)
  })
})
