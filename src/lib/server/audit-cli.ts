/// CLI: DENETÇİ REPLAY ARACI — `npm run audit [dbPath]`
///
/// GLI-19 tipi denetim için kanıt aracı: kayıtlı TÜM turları seed'den
/// yeniden üretip hash'ini karşılaştırır, cüzdan ledger zincirini ve
/// invariantını doğrular. Çıktı: denetçi raporu; herhangi bir
/// uyuşmazlıkta exit 1. Mantık `audit.ts` içinde (CI'da test edilir).
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { auditFailed, runAudit } from './audit'
import { CURRENT_CONFIG_HASH } from './config-versions'
import { openDb } from './db'

const dbPath =
  process.argv[2] ??
  process.env.SLOT_DB_PATH ??
  join(process.cwd(), '.data', 'slot.db')

if (!existsSync(dbPath)) {
  console.error(`✗ Denetim veritabanı yok: ${dbPath}`)
  process.exit(1)
}

const db = openDb(dbPath)
const findings = runAudit(db)

console.log(`Denetim: ${dbPath}`)
console.log(`Config  : ${CURRENT_CONFIG_HASH.slice(0, 16)}… (bu binary)\n`)

console.log('Kontrol Sonuçları')
console.log('─'.repeat(78))
for (const f of findings) {
  console.log(`${f.ok ? '✓' : '✗'} ${f.check.padEnd(4)} ${f.detail}`)
}

const sessions = db.prepare('SELECT COUNT(*) c FROM sessions').get() as { c: number }
const rounds = db.prepare('SELECT COUNT(*) c FROM rounds').get() as { c: number }
const drift = findings.filter((f) => f.check === 'R2' && !f.ok).length
console.log('─'.repeat(78))
console.log(`Oturum: ${sessions.c} · Round: ${rounds.c} · Config kaydırması: ${drift}`)

if (auditFailed(findings)) {
  console.log(`\n✗ DENETİM BAŞARISIZ — ${findings.filter((f) => !f.ok).length} bulgu`)
  process.exit(1)
}
console.log('\n✓ DENETİM TEMİZ — replay + ledger zinciri doğrulandı.')
