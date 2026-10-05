import { describe, expect, it } from 'vitest'
import { openDb } from './db'
import { performSpin } from './spin-service'
import {
  recordReject,
  recordSpin,
  resetTelemetry,
  telemetryReport,
} from './telemetry'
import { createSession } from './wallet'

/// Telemetri iki katmanlı: süreç sayaçları (DB dışı olaylar) +
/// DB türevli tüm-zamanlar. İkisini de doğrula.

const SESSION = 'telemetry-sess-1'

describe('telemetri (Faz 6)', () => {
  it('süreç sayaçları: spin/trigger/reddetme sayaçları ve süreç RTP\'si', () => {
    resetTelemetry()
    recordSpin({ bet: 200, win: 0, hasLink: false, hasFs: false, hasJackpot: false })
    recordSpin({ bet: 200, win: 1000, hasLink: true, hasFs: false, hasJackpot: false })
    recordSpin({ bet: 500, win: 500, hasLink: false, hasFs: true, hasJackpot: true })
    recordReject('insufficient_balance')
    recordReject('insufficient_balance')
    recordReject('invalid_request')

    const db = openDb(':memory:')
    const r = telemetryReport(db)

    expect(r.process.spins).toBe(3)
    expect(r.process.winRounds).toBe(2)
    expect(r.process.linkTriggers).toBe(1)
    expect(r.process.fsTriggers).toBe(1)
    expect(r.process.jackpots).toBe(1)
    expect(r.process.betTotal).toBe(900)
    expect(r.process.winTotal).toBe(1500)
    expect(r.process.rtp).toBeCloseTo(1500 / 900, 10)
    expect(r.process.rejections).toEqual({
      insufficient_balance: 2,
      invalid_request: 1,
    })
    expect(r.process.lastSpinAt).not.toBeNull()
    expect(r.configHash).toHaveLength(64)
  })

  it('allTime: round/sessions tablolarından türetilir (yeniden başlatmadan etkilenmez)', () => {
    resetTelemetry()
    const db = openDb(':memory:')
    createSession(db, SESSION)
    const a = performSpin(db, {
      sessionId: SESSION,
      bet: 200,
      clientRequestId: 'telem-req-000001',
    })
    const b = performSpin(db, {
      sessionId: SESSION,
      bet: 100,
      clientRequestId: 'telem-req-000002',
      force: 'link',
      allowForce: true,
    })
    expect(a.ok && b.ok).toBe(true)
    if (!a.ok || !b.ok) return

    const r = telemetryReport(db)
    expect(r.allTime.rounds).toBe(2)
    expect(r.allTime.sessions).toBe(1)
    expect(r.allTime.forcedRounds).toBe(1) // force işareti telemetriye de düşer
    expect(r.allTime.winRounds).toBe(
      [a, b].filter((x) => x.round.totalWin > 0).length,
    )
    expect(r.allTime.betTotal).toBe(300)
    expect(r.allTime.winTotal).toBe(a.round.totalWin + b.round.totalWin)
    expect(r.allTime.rtp).toBeCloseTo(r.allTime.winTotal / 300, 10)
    expect(r.allTime.lastRoundAt).not.toBeNull()

    // Süreç sayacı bu turda arttı (route bunu çağırır; burada doğrudan)
    expect(r.process.spins).toBe(0) // recordSpin çağrılmadı → süreç sayacı bağımsız
  })
})
