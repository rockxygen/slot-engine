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
npm run build && npm start   # üretim derlemesi + sunucu (http://localhost:3000)
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

src/lib/demo-round.ts    # DEMO tur kaynağı (Faz 3'te fetch('/api/spin') olacak)
src/store/game-store.ts  # Zustand: bakiye/bahis/faz — spinId artınca sahne oynatır
src/phaser/              # İstemci render katmanı (MATEMATİK YOK)
  textures.ts            # Sembol dokuları çalışma anında pişirilir (asset dosyası yok)
  scenes/GameScene.ts    # base → link → freeSpins oynatma + highlight animasyonları
  createGame.ts          # Phaser.Game fabrikası (SSR'da asla yüklenmez)
src/components/slot/     # React HUD (bakiye, bahis, ÇEVİR) + canvas mount
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

## Kalibre edilmiş matematik (20M spin nihai doğrulama)

| Metrik | Değer |
| --- | --- |
| **Toplam RTP** | **%95.93** (hedef %96.00 · 20.000.000 spin, seed `final-20m`) |
| base game | ~%59.8 |
| link bonusu | ~%12.5 · tetik **1/338** · ort. 14.2 hücre |
| free spins | ~%23.6 · tetik **1/140** |
| Hit rate | ~%47.0 |
| Max win | ~1050× bahis |
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
- [x] **Faz 4** — Phaser istemcisi (reel animasyonları, Link/FS bonus sahneleri, HUD)
- [ ] **Faz 5** — Property-based test + CI RTP kapısı + sertifikasyon hazırlığı
- [ ] **Faz 6** — Telemetri, config versiyonlama, yayın

### Demo istemci notları

- Tur kaynağı şu an `src/lib/demo-round.ts` (yerel motor). Faz 3'te tek fonksiyon
  `POST /api/spin` ile değişecek — dönen `SpinRound` aynı, arayüz değişmez.
- `/?force=link` · `/?force=fs` → bonus turları zorlar (animasyon QA'sı için;
  gerçek para modunda bonusu **sunucu** belirler).
- Smoke test: `window.__game` (store) ve `window.__phaser` (döngü dondurma)
  debug kancaları yalnızca demo içindir.
