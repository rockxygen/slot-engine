# 🍀 Clover Link Bells — Slot Engine

Clover Link tarzı (klasik meyve + Link respin bonusu) slot oyununun **matematik
motoru** ve Next.js 16 sarmalayıcısı. Hedef: **gerçek para / lisanslı** kullanım
(GLI-19 tipi RNG denetimine hazır yapı).

> Motor **saf TypeScript**'tir — sunucuda sonuç üretir, istemci yalnızca
> oynatır. Client'ta hiçbir matematik yoktur.

## Komutlar

```bash
npm run dev        # Next.js geliştirme sunucusu
npm test           # Vitest (47 test: RNG, değerlendirme, bonus, sim)
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
npm run sim -- 1000000 <seed> [bet]   # RTP/volatilite simülasyonu
```

## Mimari

```
src/lib/engine/          # SAF MOTOR (framework'süz, sunucu+istemci ortak)
  rng.ts                 # Deterministik seed'li PRNG (sfc32+xmur3), state kaydetme
  config.ts              # Oyun VERİSİ: şeritler, paytable, çizgiler, bonus kuralları
  reels.ts               # Strip + window makara modeli
  evaluate.ts            # Çizgi/scatter kazancı, wild substitution, both-ways
  spin.ts                # Tek spin (base grid)
  bonus.ts               # Link respin bonusu + Free spins serisi
  round.ts               # playRound(): base → link → freeSpins orkestrasyonu
  simulate.ts / sim-cli  # Monte Carlo RTP harness'i (kalibrasyon aracı)
  *.test.ts              # 47 test
```

## Oyun kuralları (v1)

- **5 makara × 3 satır, 20 çizgi, both-ways** (LTR + RTL), para **tamsayı**
  minor birimde (kuruş) — kayan nokta hatası yok.
- **Wild** her sembolün yerine geçer; **scatter** gridde her yerde 3+ öder.
- **Link respin bonusu**: 6+ `link` sembolü → 3 hak; dolu adımda hak sıfırlanır,
  boş adımda azalır. Hücre değerleri bet çarpanıdır; %3 şansla jackpot kademesi
  (mini 10× · minor 20× · major 100× · grand 500×) düşer.
- **Free spins**: 3+ scatter → 13/19/26 dönüş, tüm kazançlar **×4**;
  FS içinde 3+ scatter **+5** (retrigger, toplam 50 ile sınırlı).

## Kalibre edilmiş matematik (5M×2 spin doğrulaması)

| Metrik | Değer |
| --- | --- |
| **Toplam RTP** | **~%96** (hedef %96.00) |
| base game | ~%59.8 |
| link bonusu | ~%12.5 · tetik **1/333** · ort. 14.2 hücre |
| free spins | ~%23.5 · tetik **1/140** |
| Hit rate | ~%47 |
| Max win | ~1030× bahis |
| Volatilite (σ) | ~5.8× bahis |

Ayrıntılar: [`docs/CALIBRATION.md`](docs/CALIBRATION.md)

## Determinizm / denetim sözleşmesi

1. `createRng(seed)` → aynı seed her platformda **aynı** sonuç zinciri üretir
   (salt 32-bit tamsayı aritmetiği).
2. `playRound(config, rng, bet)` → base + link + freeSpins **tek RNG
   akışından** üretilir; sırası sabittir ve kayda girer.
3. Sunucu turu üretir, seed/sonuç zincirini hash'leyerek saklar → denetçi
   replay edebilir. İstemci sadece `SpinRound` verisini oynatır.

## Yol haritası

- [x] **Faz 1** — Matematik çekirdeği (RNG, şerit, değerlendirme, sim harness)
- [x] **Faz 2** — Bonus mekaniği (Link respin + Free spins) ve **RTP kalibrasyonu → %96**
- [ ] **Faz 3** — Otoriter spin endpoint'i + cüzdan (BET/WIN ledger)
- [ ] **Faz 4** — Phaser istemcisi (reel animasyonları, bonus sahneleri)
- [ ] **Faz 5** — Property-based test + CI RTP kapısı + sertifikasyon hazırlığı
- [ ] **Faz 6** — Telemetri, config versiyonlama, yayın
