/// CLI: RTP kalibrasyonu — `npm run sim -- [spins] [seed] [bet]`
import { CLOVER_LINK_BELLS } from './config'
import { formatStats, simulate } from './simulate'

const spins = Number(process.argv[2] ?? 500_000)
const seed = process.argv[3] ?? 'calibration-1'
const bet = Number(process.argv[4] ?? 100)

const stats = simulate(CLOVER_LINK_BELLS, { spins, seed, bet })
console.log(formatStats(stats))
