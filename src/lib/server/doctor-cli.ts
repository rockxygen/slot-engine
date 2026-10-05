/// CLI: YAYIN ORTAMI KONTROLÜ — `npm run doctor [-- --strict]`
///
/// Deploy öncesi ayakta kontrol (CERTIFICATION §7 "tam ortam doğrulaması"):
/// NODE_ENV, QA force kapısı (production'da AÇIKSA fail), cookie güvenliği,
/// denetim DB'si (salt-okunur quick_check), config snapshot dizini,
/// RNG entropi sağlığı. fail → exit 1; `--strict` → warn de exit 1.
/// Mantık `doctor.ts` içinde (testlerle kanıtlanır).
import { doctorExitCode, runDoctor } from './doctor'

const strict = process.argv.includes('--strict')
const report = runDoctor(process.env)

const ICON = { ok: '✓', warn: '⚠', fail: '✗' } as const

console.log('Yayın ortamı kontrolü')
console.log('─'.repeat(78))
for (const c of report.checks) {
  console.log(`${ICON[c.level]} ${c.id.padEnd(16)} ${c.detail}`)
}
console.log('─'.repeat(78))
console.log(
  `${report.failed} hata · ${report.warned} uyarı${strict ? ' · strict' : ''}`,
)

const code = doctorExitCode(report, strict)
if (code !== 0) {
  console.log(
    '\n✗ ORTAM UYGUN DEĞİL — deploy etmeyin' +
      (report.failed === 0 ? ' (strict mod)' : ''),
  )
} else {
  console.log('\n✓ ORTAM UYGUN — yayın adımlarına geçebilirsiniz.')
}
process.exit(code)
