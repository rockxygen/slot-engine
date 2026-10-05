/// CLI: DENETİM DIŞA AKTARIMI / UZAK KOPIA — `npm run audit:export`
///
///   npm run audit:export                    → .data/exports/audit-<ts>.jsonl
///   npm run audit:export -- --verify <file> → zinciri doğrula, bozuksa exit 1
///   npm run audit:export -- --ship          → yazdıktan sonra SLOT_AUDIT_SINK'e POST
///
/// WORM hikâyesi (CERTIFICATION §7): yerel SQLite + bu hash-zincirli
/// JSONL kopyası; düzenli çalıştırılır (cron/Zamanlayıcı), ikinci kopya
/// uzak uç noktaya `--ship` ile akar. `--verify` her iki kopyayı da
/// zincir üzerinden doğrular. Mantık `audit-export.ts` (test edilir).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildExport, shipExport, verifyExport } from './audit-export'
import { openDb } from './db'

const args = process.argv.slice(2)

function fail(msg: string): never {
  console.error(`✗ ${msg}`)
  process.exit(1)
}

// --verify <file>
const verifyIdx = args.indexOf('--verify')
if (verifyIdx !== -1) {
  const file = args[verifyIdx + 1]
  if (!file) fail('--verify için dosya yolu gerekli')
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch (err) {
    fail(`dosya okunamadı: ${err instanceof Error ? err.message : err}`)
  }
  const result = verifyExport(text)
  if (!result.ok) {
    console.error(
      `✗ DOĞRULAMA BAŞARISIZ — satır ${result.error?.line}: ${result.error?.detail}`,
    )
    process.exit(1)
  }
  console.log(`✓ DOĞRULANDI — ${result.lines} satır, zincir + sayım tutarlı (${file})`)
  process.exit(0)
}

// yeni dışa aktarım
const dbPath =
  process.env.SLOT_DB_PATH ?? join(process.cwd(), '.data', 'slot.db')
const db = openDb(dbPath)
const lines = buildExport(db)
const text = `${lines.join('\n')}\n`

// ilk satırdaki header'dan sayım özeti
const header = JSON.parse(lines[0]) as {
  r: { counts: { rounds: number; ledger: number } }
}

const outDir = join(process.cwd(), '.data', 'exports')
mkdirSync(outDir, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const outFile = join(outDir, `audit-${stamp}.jsonl`)
writeFileSync(outFile, text, 'utf8')

console.log(
  `✓ ${lines.length} satır yazıldı → ${outFile}` +
    ` (rounds: ${header.r.counts.rounds}, ledger: ${header.r.counts.ledger})`,
)

// yazılan dosyayı hemen geri-okuyup doğrula (kendi çıktısına güvenme)
const verify = verifyExport(readFileSync(outFile, 'utf8'))
if (!verify.ok) fail(`yazılan dosya doğrulanamadı: ${verify.error?.detail}`)
console.log('✓ yerel kopya zincir doğrulaması geçti')

// --ship: uzak uç noktaya akıt (tsx CJS → top-level await yok; promise)
if (args.includes('--ship')) {
  const sink = process.env.SLOT_AUDIT_SINK
  if (!sink) fail('SLOT_AUDIT_SINK tanımlı değil (--ship için gerekli)')
  shipExport(sink, text)
    .then(() => console.log(`✓ uzak kopya gönderildi → ${sink}`))
    .catch((err: unknown) =>
      fail(`uzak kopya başarısız: ${err instanceof Error ? err.message : err}`),
    )
}
