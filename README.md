# 🍀 Clover Link Bells — Slot Engine

Clover Link tarzı (klasik meyve + Link respin bonusu) slot oyununun **matematik
motoru** ve Next.js 16 sarmalayıcısı. Hedef: **gerçek para / lisanslı** kullanım
(GLI-19 tipi RNG denetimine hazır yapı).

> Motor **saf TypeScript**'tir — sunucuda sonuç üretir, istemci yalnızca
> oynatır. Client'ta hiçbir matematik yoktur.

## Komutlar

```bash
npm run dev        # Next.js geliştirme sunucusu
npm test           # Vitest (58 test: RNG, değerlendirme, bonus, sim, cüzdan/ledger)
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
npm run build && npm start   # üretim derlemesi + sunucu (http://localhost:3000)
npm run sim -- 1000000 <seed> [bet]   # RTP/volatilite simülasyonu
```

Denetim veritabanı: `node:sqlite` (yerleşik, bağımlılık yok) → `.data/slot.db`
(WAL; `SLOT_DB_PATH` ile değiştirilebilir; git'e girmez). Demo `force` QA kapısı
production'da `SLOT_ALLOW_FORCE=1` ile açılır.

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

src/lib/api-types.ts     # İstemci↔sunucu sözleşmesi (ALLOWED_BETS, SpinRequest/Response)
src/lib/api-client.ts    # İstemci veri kaynağı: /api/state, /api/spin, /api/demo/refill
src/lib/server/          # OTORİTER katman (sunucuda çalışır)
  db.ts                  # node:sqlite şeması: sessions / rounds / ledger
  wallet.ts              # BET-WIN-REFILL ledger + koşullu bakiye güncelleme
  spin-service.ts        # performSpin(): idempotency → transaction → replay doğrulama
  session.ts             # HttpOnly cookie oturumu (demo kimliği; gerçek parada hesap)
src/app/api/             # Route handlers: GET state · POST spin · POST demo/refill
src/store/game-store.ts  # Zustand: bakiye/bahis/faz — spinId artınca sahne oynatır
src/phaser/              # İstemci render katmanı (MATEMATİK YOK)
  textures.ts            # Sembol dokuları çalışma anında pişirilir (asset dosyası yok)
  scenes/GameScene.ts    # base → link → freeSpins oynatma + highlight animasyonları
  createGame.ts          # Phaser.Game fabrikası (SSR'da asla yüklenmez)
src/components/slot/     # React HUD (bakiye, bahis, ÇEVİR) + canvas mount
```

## Otoriter spin ve cüzdan (Faz 3)

Paranın tek kapısı sunucudur — istemcide matematik ve bakiye **yoktur**:

| Endpoint | İşlev |
| --- | --- |
| `GET /api/state` | Oturum cüzdanı (yoksa açar) + bakiye |
| `POST /api/spin` | `bet` + `clientRequestId` → doğrula → **BET çek → `playRound` → round kaydet → WIN öde** (tek SQLite transaction'ı) → `SpinRound` + bakiye |
| `POST /api/demo/refill` | Demo bakiyesi `START_BALANCE` altındaysa REFILL satırıyla tamamlar |

- **Ledger**: her hareket `kind · amount · balance_after · round_id` satırı olarak
  düşer; invariant `SUM(amount) == balance` (her oturumda test edilir).
  Açılış bakiyesi de `OPENING` satırıdır — denetçi hiç boşluk görmez.
- **Idempotency**: aynı `(session, clientRequestId)` → kayıtlı seed'den replay
  edilir, **ikinci bahis çekilmez**; aynı kimlik farklı bahisle → `409 conflict`.
- **Replay denetimi**: `rounds` tablosu seed + `sha256(round)` + config hash
  tutar; `verifyRound()` yeniden üretip hash karşılaştırır (bozulma yakalanır).
- **Force QA kapısı**: `?force=link|fs` değeri istemciden gelir ama izni
  sunucuda — development'ta açık, production'da yalnızca `SLOT_ALLOW_FORCE=1`.
  Kullanılan seed (`force-link-92` gibi) ve `forced` işareti kayda düşer.

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
- [x] **Faz 3** — Otoriter spin endpoint'i + cüzdan (BET/WIN ledger, idempotency, replay denetimi)
- [x] **Faz 4** — Phaser istemcisi (reel animasyonları, Link/FS bonus sahneleri, HUD)
- [ ] **Faz 5** — Property-based test + CI RTP kapısı + sertifikasyon hazırlığı
- [ ] **Faz 6** — Telemetri, config versiyonlama, yayın

### Demo istemci notları

- Tur kaynağı **yalnızca** `POST /api/spin`'dir (`src/lib/api-client.ts`);
  yerel motor/simülasyon istemciden tamamen kaldırıldı (`demo-round.ts` silindi).
- Bakiye sunucudur: açılışta `GET /api/state`, tur sonunda spin yanıtının
  `pendingBalance`'ı settle anında görünür olur → **sayfa yenilense de kalıcı**.
- `/?force=link` · `/?force=fs` → bonus turları zorlar (animasyon QA'sı için).
  İzin sunucuda: dev'de açık, `npm start`'te `SLOT_ALLOW_FORCE=1` gerekir;
  gerçek para modunda bonusu **sunucu** belirler.
- Smoke test: `window.__game` (store) ve `window.__phaser` (döngü dondurma)
  debug kancaları yalnızca demo içindir.
