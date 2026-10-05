import type { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import {
  authenticate,
  bindSessionToPlayer,
  hashPassword,
  kycGate,
  registerPlayer,
  sessionPlayer,
  setKycStatus,
  unbindSession,
  verifyPassword,
} from './accounts'
import { openDb } from './db'
import { performSpin } from './spin-service'
import { createSession, getBalance, listLedger } from './wallet'

/// Hesap / KYC katmanı (Faz 7 · §7): scrypt parola, oturum-oyuncu bağı,
/// "doğrulanmadan tur yok" kapısı. Anonim demo politikası korunur.

const SESSION = 'accounts-sess-1'

function freshDb(): DatabaseSync {
  const db = openDb(':memory:')
  createSession(db, SESSION)
  return db
}

const spin = (db: DatabaseSync, reqId: string, opts: { requireAccount?: boolean } = {}) =>
  performSpin(db, {
    sessionId: SESSION,
    bet: 200,
    clientRequestId: reqId,
    requireAccount: opts.requireAccount,
  })

describe('hesap/KYC katmanı (Faz 7)', () => {
  it('scrypt parola: format, doğru/yanlış doğrulama', () => {
    const h = hashPassword('sifre-1234')
    expect(h).toMatch(/^scrypt\$16384\$8\$1\$[0-9a-f]{32}\$[0-9a-f]{64}$/)
    expect(verifyPassword('sifre-1234', h)).toBe(true)
    expect(verifyPassword('sifre-1235', h)).toBe(false)
    expect(verifyPassword('sifre-1234', 'bozuk-kayit')).toBe(false)
    expect(() => hashPassword('kisa')).toThrow(RangeError)
  })

  it('register: doğrulama + tekil kullanıcı adı', () => {
    const db = freshDb()
    const p = registerPlayer(db, 'olcay', 'guclu-parola-1')
    expect(p.kycStatus).toBe('pending')

    expect(() => registerPlayer(db, 'ab', 'guclu-parola-1')).toThrow(RangeError)
    expect(() => registerPlayer(db, 'BÜYÜK-HARF', 'guclu-parola-1')).toThrow(RangeError)
    expect(() => registerPlayer(db, 'boşluk var', 'guclu-parola-1')).toThrow(RangeError)
    expect(() => registerPlayer(db, 'yeni-1', 'kisa')).toThrow(RangeError)
    expect(() => registerPlayer(db, 'olcay', 'baska-parola-1')).toThrow(
      'Bu kullanıcı adı alınmış',
    )
  })

  it('authenticate: doğru bilgi → oyuncu; hatalı → null', () => {
    const db = freshDb()
    registerPlayer(db, 'olcay', 'guclu-parola-1')
    expect(authenticate(db, 'olcay', 'guclu-parola-1')?.username).toBe('olcay')
    expect(authenticate(db, 'olcay', 'yanlis-parola')).toBeNull()
    expect(authenticate(db, 'olmayan', 'guclu-parola-1')).toBeNull()
  })

  it('KYC kapısı: pending → tur YOK; verified → oyna; rejected → yine YOK', () => {
    const db = freshDb()
    const p = registerPlayer(db, 'olcay', 'guclu-parola-1')
    bindSessionToPlayer(db, SESSION, p.id)
    const balance = getBalance(db, SESSION)
    const ledgerLen = listLedger(db, SESSION).length

    const blocked = spin(db, 'kyc-req-0001')
    expect(blocked).toEqual({
      ok: false,
      reason: 'kyc_required',
      kyc: 'kyc_pending',
    })
    // İz yok
    expect(getBalance(db, SESSION)).toBe(balance)
    expect(listLedger(db, SESSION)).toHaveLength(ledgerLen)

    setKycStatus(db, p.id, 'verified')
    expect(spin(db, 'kyc-req-0001').ok).toBe(true)

    setKycStatus(db, p.id, 'rejected')
    const rejected = spin(db, 'kyc-req-0002')
    expect(rejected).toEqual({
      ok: false,
      reason: 'kyc_required',
      kyc: 'kyc_pending',
    })
  })

  it('anonim politika: varsayılan serbest; SLOT_REQUIRE_KYC=1 → hesap zorunlu', () => {
    const db = freshDb()
    // varsayılan: anonim demo oynar
    expect(kycGate(db, SESSION, false)).toBe('ok')
    expect(spin(db, 'kyc-req-0003').ok).toBe(true)

    // politika açık: anonim blok
    expect(kycGate(db, SESSION, true)).toBe('account_required')
    const blocked = spin(db, 'kyc-req-0004', { requireAccount: true })
    expect(blocked).toEqual({
      ok: false,
      reason: 'kyc_required',
      kyc: 'account_required',
    })
  })

  it('idempotent replay KYC kapısını geçer (bahis zaten alınmış)', () => {
    const db = freshDb()
    const first = spin(db, 'kyc-req-0005')
    expect(first.ok).toBe(true)

    // tur sonrası politika sıkılaştırıldı (anonim → hesap zorunlu)
    const replay = spin(db, 'kyc-req-0005', { requireAccount: true })
    expect(replay.ok).toBe(true)
    if (first.ok && replay.ok) {
      expect(replay.roundId).toBe(first.roundId)
      expect(replay.balance).toBe(first.balance)
    }
  })

  it('çıkış (unbind): oyuncu bağı kalkar → politika anonim kuralına döner', () => {
    const db = freshDb()
    const p = registerPlayer(db, 'olcay', 'guclu-parola-1')
    setKycStatus(db, p.id, 'verified')
    bindSessionToPlayer(db, SESSION, p.id)
    expect(sessionPlayer(db, SESSION)?.username).toBe('olcay')
    expect(spin(db, 'kyc-req-0006', { requireAccount: true }).ok).toBe(true)

    unbindSession(db, SESSION)
    expect(sessionPlayer(db, SESSION)).toBeNull()
    expect(
      spin(db, 'kyc-req-0007', { requireAccount: true }),
    ).toEqual({ ok: false, reason: 'kyc_required', kyc: 'account_required' })
  })
})
