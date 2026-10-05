/// Ses varlıklarını sentezleyip `public/audio/*.wav` dosyalarına yazar.
/// Kullanım: `npm run audio:gen` — çıktının kendisi commit'lenir (deterministik).
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  AUDIO_SAMPLE_RATE,
  SOUND_NAMES,
  renderSound,
  wavBytes,
} from '@/lib/audio/synth'

const outDir = join(process.cwd(), 'public', 'audio')
mkdirSync(outDir, { recursive: true })

for (const name of SOUND_NAMES) {
  const wav = wavBytes(renderSound(name), AUDIO_SAMPLE_RATE)
  const path = join(outDir, `${name}.wav`)
  writeFileSync(path, wav)
  console.log(`${name}.wav  ${(wav.length / 1024).toFixed(1)} KB`)
}
console.log(`✓ ${SOUND_NAMES.length} ses → ${outDir}`)
