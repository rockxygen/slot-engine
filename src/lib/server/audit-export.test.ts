import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, expect, it } from 'vitest'
import { buildExport, shipExport, verifyExport } from './audit-export'
import { openDb } from './db'
import { performSpin } from './spin-service'
import { createSession } from './wallet'

/// Hash-zincirli denetim dışa aktarımı (Faz 7 · §7 — WORM/uzak kopya):
/// zincir bozulursa/sayımlar tutmazsa yakalanır; uzak uç noktaya akış
/// gerçek HTTP ile sınanır.

function seededDb() {
  const db = openDb(':memory:')
  createSession(db, 'export-sess-1')
  const a = performSpin(db, {
    sessionId: 'export-sess-1',
    bet: 200,
    clientRequestId: 'export-req-0001',
  })
  const b = performSpin(db, {
    sessionId: 'export-sess-1',
    bet: 500,
    clientRequestId: 'export-req-0002',
    force: 'fs',
    allowForce: true,
  })
  if (!a.ok || !b.ok) throw new Error('seed spin başarısız')
  return db
}

describe('denetim dışa aktarımı (Faz 7)', () => {
  it('üret → doğrula: zincir + header sayımı tutarlı', () => {
    const db = seededDb()
    const text = `${buildExport(db).join('\n')}\n`
    const v = verifyExport(text)
    expect(v.ok).toBe(true)
    expect(v.countsMatch).toBe(true)

    // WIN satırı koşullu (tura göre) → sayaçlar DB'den alınır
    const rCount = (db.prepare('SELECT COUNT(*) c FROM rounds').get() as { c: number }).c
    const lCount = (db.prepare('SELECT COUNT(*) c FROM ledger').get() as { c: number }).c
    expect(v.lines).toBe(1 + rCount + lCount)

    const header = JSON.parse(text.split('\n')[0]) as { r: { counts: { rounds: number; ledger: number } } }
    expect(header.r.counts.rounds).toBe(2)
    expect(header.r.counts.ledger).toBe(lCount)
  })

  it('satır İÇERİĞİ değiştirilirse (kazanç şişirme) → yakalanır', () => {
    const db = seededDb()
    const lines = buildExport(db)
    // 2. satır = ilk round: win değerini değiştir ama hash'i aynen bırak
    const line = JSON.parse(lines[1]) as { r: { win: number } }
    line.r.win = 999_999
    lines[1] = JSON.stringify(line)

    const v = verifyExport(lines.join('\n'))
    expect(v.ok).toBe(false)
    expect(v.error?.detail).toContain('hash uyuşmuyor')
  })

  it('satır SİLİNİRSE → zincir kırığı yakalanır', () => {
    const db = seededDb()
    const lines = buildExport(db)
    const withoutOne = lines.slice(0, 2).concat(lines.slice(3)) // round satırı sil
    const v = verifyExport(withoutOne.join('\n'))
    expect(v.ok).toBe(false)
    expect(v.error?.detail).toContain('zincir kırık')
  })

  it('satır EKLENİRSE → zincir DÜZGÜN onarılsa bile header sayım kontrolü yakalar', () => {
    const db = seededDb()
    const lines = buildExport(db)
    // Saldırgan son satırı kopyalayıp zinciri düzgünce onarsa bile:
    // header'daki sayımla kayıt sayısı tutmaz → sessiz ekleme imkânsız
    const last = JSON.parse(lines[lines.length - 1]) as {
      h: string
      r: Record<string, unknown>
    }
    const forgedH = createHash('sha256')
      .update(last.h + JSON.stringify(last.r))
      .digest('hex')
    lines.push(JSON.stringify({ p: last.h, h: forgedH, r: last.r }))

    const v = verifyExport(lines.join('\n'))
    expect(v.ok).toBe(false)
    expect(v.error?.detail).toContain('sayım uyuşmuyor')
  })

  it('uzak uç noktaya gönderim (--ship) gerçek HTTP ile çalışır', async () => {
    const db = seededDb()
    const text = `${buildExport(db).join('\n')}\n`

    let received = ''
    let receivedType = ''
    const server: Server = createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (c: Buffer) => chunks.push(c))
      req.on('end', () => {
        received = Buffer.concat(chunks).toString('utf8')
        receivedType = String(req.headers['content-type'])
        res.statusCode = 204
        res.end()
      })
    })
    await new Promise<void>((resolve) => server.listen(0, resolve))
    const port = (server.address() as AddressInfo).port

    try {
      await shipExport(`http://127.0.0.1:${port}/audit`, text)
      expect(received).toBe(text)
      expect(receivedType).toContain('ndjson')
      // uzak kopya da zincirden geçer
      expect(verifyExport(received).ok).toBe(true)
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      )
    }
  })

  it('uzak uç nokta hata dönerse → shipExport fırlatır (sessiz kayıp yok)', async () => {
    const server: Server = createServer((_req, res) => {
      res.statusCode = 500
      res.end()
    })
    await new Promise<void>((resolve) => server.listen(0, resolve))
    const port = (server.address() as AddressInfo).port
    try {
      await expect(
        shipExport(`http://127.0.0.1:${port}/audit`, '{}\n'),
      ).rejects.toThrow(/HTTP 500/)
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      )
    }
  })
})
