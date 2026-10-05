import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { ALLOWED_BETS } from '@/lib/api-types'
import { openDb } from './db'
import { listRounds, performSpin, verifyRound } from './spin-service'
import {
  createSession,
  getBalance,
  ledgerSum,
  listLedger,
  refillDemo,
  START_BALANCE,
} from './wallet'

/// Faz 5 — PROPERTY-BASED TEST: cüzdan durum makinesi
///
/// Rastgele op dizileri (spin/refill, kasıtlı tekrarlanan istek
/// kimlikleri, yetersiz bakiye, force) yürütülür ve HER ADIMDA
/// değişmeyen sözleşmeler doğrulanır:
///   1) bakiye asla negatif değil
///   2) ledger invariantı: SUM(amount) == balance
///   3) balance_after zinciri açılıştan bugüne kesintisiz
///   4) her round kaydı seed'den replay edilebilir (hash tutar)
///   5) başarısız op → dünya DEĞİŞMEZ (ne bakiye ne satır sayısı)
///   6) idempotency: aynı kimlik ASLA ikinci kez bahis çekmez

type Op =
  | { kind: 'spin'; bet: number; id: string; force: 'link' | 'fs' | null }
  | { kind: 'refill' }

/// Küçük istek-kimliği havuzu → kasıtlı olarak çakışma/replay üretir
const REQ_POOL = ['fc-req-aaaa1111', 'fc-req-bbbb2222', 'fc-req-cccc3333']

const opArb: fc.Arbitrary<Op> = fc.oneof(
  { weight: 9, arbitrary: fc.constant<Op>({ kind: 'refill' }) },
  {
    weight: 40,
    arbitrary: fc
      .tuple(
        fc.constantFrom(...ALLOWED_BETS),
        fc.constantFrom(...REQ_POOL),
        fc.constantFrom<'link' | 'fs' | null>(null, null, null, 'link'),
      )
      .map(([bet, id, force]): Op => ({ kind: 'spin', bet, id, force })),
  },
)

interface Snapshot {
  balance: number
  rounds: number
  ledger: number
}

const snap = (db: ReturnType<typeof openDb>, sid: string): Snapshot => ({
  balance: getBalance(db, sid),
  rounds: listRounds(db, sid).length,
  ledger: listLedger(db, sid).length,
})

const SESSION = 'fc-session-1'

describe('property: cüzdan durum makinesi', () => {
  it('rastgeel op dizisi tüm ledger/idempotency/replay sözleşmelerini korur', () => {
    fc.assert(
      fc.property(fc.array(opArb, { minLength: 1, maxLength: 30 }), (ops) => {
        // Her çalıştırma taze bellek içi DB
        const db = openDb(':memory:')
        createSession(db, SESSION)
        /// kullanılmış kimlikler: id → { bet, roundId } (dışarıda kanıt)
        const used = new Map<string, { bet: number; roundId: number }>()

        ops.forEach((op) => {
          const before = snap(db, SESSION)

          if (op.kind === 'refill') {
            const wasBelow = before.balance < START_BALANCE
            refillDemo(db, SESSION)
            const after = snap(db, SESSION)
            if (wasBelow) {
              expect(after.balance).toBe(START_BALANCE)
              expect(after.ledger).toBe(before.ledger + 1)
            } else {
              expect(after).toEqual(before) // üstünde dokunmaz
            }
          } else {
            const prior = used.get(op.id)
            const out = performSpin(db, {
              sessionId: SESSION,
              bet: op.bet,
              clientRequestId: op.id,
              force: op.force,
              allowForce: op.force !== null,
            })
            const after = snap(db, SESSION)

            if (out.ok && prior === undefined) {
              // TAZE tur: para formülü tutar
              expect(after.balance).toBe(
                before.balance - op.bet + out.round.totalWin,
              )
              expect(after.rounds).toBe(before.rounds + 1)
              used.set(op.id, { bet: op.bet, roundId: out.roundId })
              // Replay denetimi: bu kayıt seed'den yeniden üretilir
              expect(verifyRound(db, out.roundId).ok).toBe(true)
            } else if (out.ok && prior) {
              // TEKRAR aynı kimlik+bet: idempotent replay — DÜNYA DOKUNULMAZ
              expect(out.roundId).toBe(prior.roundId)
              expect(after).toEqual(before)
            } else {
              // BAŞARISIZ (yetersiz / force kapalı / request_conflict)
              // → hiçbir iz kalmaz
              expect(after).toEqual(before)
              if (prior && prior.bet !== op.bet) {
                expect(out).toEqual({ ok: false, reason: 'request_conflict' })
              }
            }
          }

          // Her adımda değişmeyen invariantlar
          const balance = getBalance(db, SESSION)
          expect(balance).toBeGreaterThanOrEqual(0)
          expect(ledgerSum(db, SESSION)).toBe(balance)

          let running = 0
          for (const row of listLedger(db, SESSION)) {
            running += row.amount
            expect(row.balance_after).toBe(running)
          }
        })

        // Sonda: TÜM round kayıtları seed'den replay edilebilir
        for (const r of listRounds(db, SESSION)) {
          expect(verifyRound(db, r.id).ok).toBe(true)
        }
      }),
      { numRuns: 60 },
    )
  }, 30_000)
})
