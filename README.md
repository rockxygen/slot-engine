# 🍀 Clover Link Bells — Slot Engine

Clover Link tarzı (klasik meyve + Link respin bonusu) slot oyununun **matematik
motoru** ve Next.js 16 sarmalayıcısı. Hedef: **gerçek para / lisanslı** kullanım
(GLI-19 tipi RNG denetimine hazır yapı).

> Motor **saf TypeScript**'tir — sunucuda sonuç üretir, istemci yalnızca
> oynatır. Client'ta hiçbir matematik yoktur.

## Komutlar

```bash
npm run dev        # Next.js geliştirme sunucusu
npm test           # Vitest (163 test: RNG, motor, jackpot, bonus, cüzdan, property, denetim, telemetri, limit, KYC, ses, UI)
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
npm run build && npm start   # üretim derlemesi + sunucu (http://localhost:3000)
npm run audio:gen  # ses WAV'larını sentezler → public/audio (deterministik, commit'li)
npm run sim -- 1000000 <seed> [bet]   # RTP/volatilite simülasyonu
npm run gate [-- spins seed]   # CI RTP kapısı (kalibre bantlar, exit 1 = kapalı)
npm run audit [-- dbPath]      # denetçi replay aracı (R1-L3 raporu, exit 1 = bulgu)
npm run doctor [-- --strict]   # yayın ortamı postürü (force/cookie/DB/entropi; strict = deploy kapısı)
npm run audit:export [-- --verify <file>] [-- --ship]  # hash-zincirli uzak denetim kopyası
npm run release    # yayın zinciri: typecheck && lint && test && build && gate && audit && doctor
```

Denetim veritabanı: `node:sqlite` (yerleşik, bağımlılık yok) → `.data/slot.db`
(WAL; `SLOT_DB_PATH` ile değiştirilebilir; git'e girmez). Demo `force` QA kapısı
production'da `SLOT_ALLOW_FORCE=1` ile açılır. Ortam değişkenleri şablonu:
`.env.example`; yayın runbook'u: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## Mimari

```
src/lib/engine/          # SAF MOTOR (framework'süz, sunucu+istemci ortak)
  rng.ts                 # Deterministik seed'li PRNG (sfc32+xmur3), state kaydetme
  config.ts              # Oyun VERİSİ: şeritler, paytable, çizgiler, bonus kuralları
  reels.ts               # Strip + window makara modeli
  evaluate.ts            # Çizgi/scatter kazancı, wild substitution, both-ways
  spin.ts                # Tek spin (base grid)
  bonus.ts               # Link respin bonusu + Free spins serisi
  jackpot.ts             # 5 kademe + spin düşüşü (orantılı ödül: bet × k)
  round.ts               # playRound(): base → jackpot → link → freeSpins
  simulate.ts / sim-cli  # Monte Carlo RTP harness'i (kalibrasyon aracı)
  *.test.ts              # 74 test

src/lib/api-types.ts     # İstemci↔sunucu sözleşmesi (ALLOWED_BETS, SpinRequest/Response)
src/lib/api-client.ts    # İstemci veri kaynağı: /api/state, /api/spin, /api/demo/refill
src/lib/audio/synth.ts   # Prosedürel ses sentezi: 8 ses, saf matematik → WAV (+test)
scripts/gen-audio.ts     # `npm run audio:gen` → public/audio/*.wav (commit'li varlık)
src/lib/server/          # OTORİTER katman (sunucuda çalışır)
  db.ts                  # node:sqlite şeması: sessions / rounds / ledger / players (+migrasyon)
  wallet.ts              # BET-WIN-REFILL ledger + koşullu bakiye güncelleme
  spin-service.ts        # performSpin(): idempotency → KYC → RNG → limitler → transaction
  config-versions.ts     # config sürümleme: snapshot üret/yükle, replay config çözümü
  entropy.ts             # RNG sağlık testi (zayıf kaynak → oyun durur)
  limits.ts              # sorumlu oyun: kayıp/ciro/süre limitleri (sunucuda zorlu)
  accounts.ts            # hesap/KYC: scrypt parola, kyc_status, oturum-oyuncu bağı
  telemetry.ts           # süreç sayaçları + DB tüm-zamanlar metrik raporu
  doctor.ts / audit.ts   # ortam postürü + denetçi motoru (R1-R2, L1-L3)
  audit-export.ts        # hash-zincirli denetim dışa aktarımı + uzak kopya (--ship)
  session.ts             # HttpOnly cookie oturumu (altına oyuncu bağı — Faz 7)
src/app/api/             # GET state · POST spin · POST demo/refill
                         # GET health (liveness+entropi) · GET telemetry · GET/PUT limits
                         # POST auth/register · auth/login · auth/logout · auth/kyc
src/store/game-store.ts  # Zustand: bakiye/bahis/faz — spinId artınca sahne oynatır
src/phaser/              # İstemci render katmanı (MATEMATİK YOK)
  textures.ts            # Dokular anında pişirilir: bg gradient+vignette, kartlar,
                         # spark partikülü, kazanç çerçevesi (asset dosyası yok)
  scenes/GameScene.ts    # base → link → freeSpins oynatma + highlight + ses kancaları
  createGame.ts          # Phaser.Game fabrikası (SSR'da asla yüklenmez)
src/components/slot/     # React HUD (bakiye, bahis, ÇEVİR, AUTO, ses) + canvas mount
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
- **Force QA kapısı**: `?force=link|fs|jackpot` değeri istemciden gelir ama izni
  sunucuda — development'ta açık, production'da yalnızca `SLOT_ALLOW_FORCE=1`.
  Kullanılan seed (`force-link-92` gibi) ve `forced` işareti kayda düşer.

## Regresyon kapıları ve property testler (Faz 5)

- **Property-based test** (fast-check): tek örnek değil, rastgeel girdi
  uzayı zorlar — determinizm, `totalWin = base+jackpot+link+fs` kompozisyonu,
  **lineer bahis ölçeklemesi** (`win(k·bet) = k·win(bet)` tam eşitlik —
  para kaçırıcı her yuvarlama hatası bu özelliği kırar), tamsayı/lineBet
  katı para, jackpot kademe/çarpan sözleşmesi, link hücre toplamı, FS
  `result×çarpan`, RNG durum geri yükleme (replay temeli) ve **cüzdan durum
  makinesi** (rastgeel spin/refill/idempotency dizilerinde ledger invariantı
  her adımda).
- **RTP kapısı**: `npm run gate` → 2M spin, seed `rtp-gate-1`
  (deterministik = tekrarlanabilir); bantlar kalibrasyonla kilitli
  (RTP %95.40–96.60, jackpot bileşeni %0.15–0.75, katkılar, hit, tetik
  frekansları, max win, σ).
  Bant dışına çıkan her matematik değişikliği **exit 1 → CI düşer**
  (`.github/workflows/ci.yml`).
- **Denetçi replay aracı**: `npm run audit` → tüm round'ları seed'den
  yeniden üretir (R1), config sürümünü (R2 = değişiklik kontrolü),
  ledger zincirini (L1), `SUM(amount)==balance` invariantını (L2) ve
  BET/WIN↔round bağlarını (L3) raporlar. Motor `audit.ts` içinde ve
  **bozuk seed/config/zincir senaryolarıyla test ediliyor**.
- Kontrol haritası + üretim öncesi boşluklar:
  [`docs/CERTIFICATION.md`](docs/CERTIFICATION.md)

## Config versiyonlama, telemetri ve yayın (Faz 6)

- **Config sürümleme**: her binary ilk turda oyun verisinin snapshot'ını
  `.data/config-versions/<hash>.json`'a yazar (dosya adı = içeriğin
  sha256'sı; bütünlük yüklemede doğrulanır). Config değişince **eski
  dosya kalır** → denetim R1/R2 artık eski sürümle replay eder;
  snapshot yoksa **FAIL** (`config-versions.test.ts` — sahte içerik,
  bozuk dosya, eksik sürüm senaryoları dahil).
- **Telemetri**: `GET /api/telemetry` → `process` (bu sürecin sayaçları:
  tur, link/FS tetikleri, jackpot düşüşleri, reddetmeler, süreç RTP'si) + `allTime`
  (denetim DB'sinden: rounds, forced, bet/win, RTP, son tur) +
  `configHash`. `GET /api/health` → yazmasız liveness + canlı config
  parmak izi (deploy doğrulaması; 503 = DB erişilemez).
- **Yayın**: `npm run release` tek komutta tüm kapılar;
  [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) → ortam değişkenleri,
  süreç yönetimi, TLS/ters proxy, yedekleme (`.data/` + config
  snapshot'ları birlikte), geri dönüş, yayın sonrası doğrulama.

## Üretim sertifikasyon boşlukları (Faz 7 — CERTIFICATION §7)

- **Entropi**: `randomSeed()` yalnızca CSPRNG (yoksa **hata** — `Math.random`
  fallback kaldırıldı); startup sağlık testi (sıfır/sabit/tekrar/monobit)
  başarısızsa `performSpin` tur üretmez (`503 rng_unhealthy`) ve `/api/health`
  raporlar.
- **`npm run doctor`**: yayın ortamı postürü kodla ölçülür — NODE_ENV,
  QA force kapısı production'da **açıksa fail**, cookie `Secure`, DB
  `quick_check`, snapshot yazılabilirlik, entropi. `--strict` → deploy kapısı.
- **Sorumlu oyun**: kayıp/ciro/süre limitleri sunucuda zorlu
  (`403 limit_exceeded`, ihlalde iz yok); `GET/PUT /api/limits`.
- **WORM uzak kopya**: `npm run audit:export` → hash-zincirli JSONL
  (ekleme/silme/değiştirme zinciri kırar, header sayımı onarılmış eklemeyi
  de tutmaz); `--verify` + `--ship` (`SLOT_AUDIT_SINK`).
- **Hesap/KYC**: `players` + scrypt parola + register/login/logout,
  `kyc_status` kapısı — `pending`/`rejected` tur oynayamaz; anonim oyun
  `SLOT_REQUIRE_KYC=1` ile tamamen kapanır. Detay: `docs/DEPLOYMENT.md §10`.
- **UI**: TopBar'dan **Giriş** (kayıt/giriş/KYC demo onay) ve **Limitler**
  (net/ciro/süre kullanımı + ₺/dk formu) panelleri; `kyc_required` /
  `limit_exceeded` engelinde ilgili panel otomatik açılır.

## Ses, otomatik dönüş ve görsel iyileştirme (Faz 8)

- **Prosedürel ses** (`src/lib/audio/synth.ts`): spin whoosh, makara duruşu,
  scatter, **zil**, kazanç, büyük kazanç fanfarı, link bonus, jackpot — 8 ses
  **saf matematikle** üretilir (FM çan, sweep'li gürültü, akor/arpaj);
  deterministiktir, birim testiyle doğrulanır (`wavBytes` 16-bit PCM).
  `npm run audio:gen` → `public/audio/*.wav` (commit'li); Phaser `preload`
  ile yükler, dosya yoksa sessiz geçer. Lisanslı üründe asset lisansı ayrı
  bir denetim konusudur — sentez kodu denetlenebilir kalır.
- **Ses kancaları** (`GameScene`): çevrim, makara tıkları (ritmik `rate`
  varyasyonu + duruş sekmesi), scatter ipucu (1-2 yumuşak / 3+ parlak),
  **zil kazançta**, 5× bahis üstü → `bigwin` fanfarı + ekran parıltısı,
  link/jackpot bonus fanfarları. TopBar 🔊/🔇 → `sound.mute`, tercih
  localStorage'da (hydration sonrası okunur).
- **Otomatik dönüş**: `AUTO ▶ ×10/25/50` (ön ayar döngüsü) — tur `settle`
  olunca 650 ms sonra sıradaki; **hata (limit/KYC/402), bakiye yetersiz,
  sayaç 0 veya elle durdurma** → temiz kapanış; çalışırken bahis değişmez.
  Oyunun kendisi sunucuda: client yalnızca `spin()` çağırır — auto-spin bu
  demo için istemcide tetiklenir, gerçek üründe tur tetikleme sunucu
  oturumuna taşınır.
- **Görseller**: tam ekran gradient + vignette + yıldız tozu (kırpma bantları
  aynı dokudan → kesintisiz), çift altın çerçeve + köşe elmasları, makara
  paneli/ayırıcıları, gloss'lu + accent kenarlı kartlar, kazançta altın
  çerçeve parıltısı + parıltı patlaması, banner pop, başlık nabzı.

## Jackpot — 5 kademe (Faz 9)

- **Mini · Minor · Maxi · Major · Grand** — ödül **orantılı** başlattı: her
  zaman `bet × kademe çarpanı` = **10× · 20× · 50× · 100× · 500×**. Ağırlıklar
  (40/30/16/10/4) küçük kademeleri sık, grand'ı nadir yapar (beklenen 48×).
- **Her normal spine şans**: `jackpot.spinChance = 1/10.000` → jackpot, tur
  RNG akışında base spin'den **sonra**, link/FS'den önce çizilir (sıra sabit
  → seed zinciri ve replay'e dahil). Beklenen RTP katkısı ~+%0.5.
- **Tek kademe tablosu** (`config.jackpot.tiers`): hem normal spin düşüşü
  hem Link bonusu hücreleri (%3 şans) aynı kademeleri kullanır — simetri,
  tek gerçek kaynağı.
- **Prize bar**: makaranın altında 5 kademe göstergesi (`MINI 10×` …
  `GRAND 500×`, kademe renginde) sabit durur; düştüğünde çip parlar +
  `JACKPOT! KADEME` banner + fanfar + ödül sayımı. `SpinRound.jackpot`
  sunucudan gelir, istemci yalnızca oynatır (client'ta matematik yok).
- **Ops/QA**: `GET /api/telemetry → process.jackpots` · `/?force=jackpot`
  ile düşüş zorlanır. Kalibrasyon: [`docs/CALIBRATION.md`](docs/CALIBRATION.md)
  (Tur 10) — kapı 2M'de TOPLAM %96.22, jackpot %0.55 (1/9.524), Δ=0.
- **Denetim geriye uyumluluğu**: SpinRound'a `jackpot` alanı eklenmesi ve
  tur RNG akışına 1 adım eklenmesi Faz 9 öncesi kayıtları KIRMAZ — eski
  config snapshot'larında jackpot çizimi adımsız atlanır (akış birebir aynı
  kalır), eski `round_hash`'ler `legacyRoundHash` ile (jackpot anahtarsız
  JSON) karşılaştırılır; idempotent retry turu oynandığı config ile
  replay eder. Test: `config-versions.test.ts → "Faz 9 öncesi tur … R1+R2
  +verifyRound geçer"` (gerçek DB'de `npm run audit` 66/66 ✓).

## Çan respin bonusu (Faz 10)

- **Ayrı ve bağımsız** ikinci Hold & Win bonusu (link bonusu aynen durur):
  gridde **5+ çan** → **3 respin hakkı**; her **yeni çan** hakkı 3'e
  sıfırlar, **3 boş adımda** tur kapanır ve toplanan çanların toplamı ödenir.
- **Çanlara bet oranlı para**: hücre değeri = bet çarpanı (0.5×–10× arası
  ağırlıklı); çanların içine **%2 şansla jackpot-kadeli çan** düşer —
  mini/minor/maxi/major/grand = 10×/20×/50×/100×/500× (link ile **ortak**
  `config.jackpot.tiers` tablosu).
- **15 çan toplanırsa** (grid tamamen dolu) toplam ödül **×3**
  (`bell.fullMultiplier`). stepCounts bilinçli boş ağırlıklı tutuldu: tam
  doluluk nadirdir → ×3 gerçek bir "özel an" olsun.
- **Sıra ve determinizm**: tur akışı base → jackpot → link → **çan** → FS;
  eski config'te (`bell` anahtarı yok) bonus **hiç çizilmez ve RNG adımı
  harcanmaz** (akış birebir aynı). Eski `round_hash`'ler `faz9RoundHash`
  (bell anahtarsız JSON) ile 3. şekil olarak eşleşir; gerçek DB'deki
  Faz 9 kayıtları `npm run audit` ile doğrulanmaya devam eder.
  Testler: `bell.test.ts` (12), `config-versions.test.ts → "Faz 9 turu …"`,
  `properties.test.ts` çan yapısı.
- **Ops/QA**: `GET /api/telemetry → process.bellTriggers` · `/?force=bell`
  ile bonus zorlanır. Kalibrasyon: [`docs/CALIBRATION.md`](docs/CALIBRATION.md)
  (Tur 11) — kapı 2M'de TOPLAM %95.945, çan %1.65 (tetik 1/4049), Δ=0.

## Oyun kuralları (v1)

- **5 makara × 3 satır, 20 çizgi, both-ways** (LTR + RTL), para **tamsayı**
  minor birimde (kuruş) — kayan nokta hatası yok.
- **Wild** her sembolün yerine geçer; **scatter** gridde her yerde 3+ öder.
- **Link respin bonusu**: 6+ `link` sembolü → 3 hak; dolu adımda hak sıfırlanır,
  boş adımda azalır. Hücre değerleri bet çarpanıdır; %2 şansla jackpot kademesi
  (5 kademe, tek tablo) düşer.
- **Çan respin bonusu (Faz 10)**: 5+ `bell` → 3 hak, yeni çanda hak 3'e sıfırlanır,
  3 boş adımda toplanan çanların bet-oranlı toplamı ödenir; %2 şansla
  jackpot-kadeli çan; **15 dolu → ödül ×3**. Link bonusundan bağımsızdır.
- **Jackpot**: her normal spinde 1/10.000 şansla kademe düşer — ödül bahis
  orantılı (mini 10× · minor 20× · maxi 50× · major 100× · grand 500×);
  bedava dönüşlerde çizilmez.
- **Free spins**: 3+ scatter → 13/19/26 dönüş, tüm kazançlar **×4**;
  FS içinde 3+ scatter **+5** (retrigger, toplam 50 ile sınırlı).

## Kalibre edilmiş matematik (Faz 10 · RTP kapısı ölçümü)

| Metrik | Değer |
| --- | --- |
| **Toplam RTP** | **%95.95** (hedef %96.00 · kapı: 2.000.000 spin, seed `rtp-gate-1`) |
| base game | ~%59.8 |
| **jackpot** | **~%0.57** · spin düşüşü **1/9.346** (spinChance 1/10.000) |
| link bonusu | ~%10.7 · tetik **1/344** · ort. 14.2 hücre |
| **çan bonusu** | **~%1.65** · tetik **1/4.049** · ort. 12.1 hücre |
| free spins | ~%23.2 · tetik **1/141** |
| Hit rate | ~%47.0 |
| Max win | ~1684× bahis (kapı bantı 500–2000 — çan full ×3 + grand çan) |
| Volatilite (σ) | ~6.15× bahis |

Faz 10 kalibrasyonu: [`docs/CALIBRATION.md`](docs/CALIBRATION.md) (Tur 11).

## Determinizm / denetim sözleşmesi

1. `createRng(seed)` → aynı seed her platformda **aynı** sonuç zinciri üretir
   (salt 32-bit tamsayı aritmetiği).
2. `playRound(config, rng, bet)` → base + jackpot + link + **bell** + freeSpins
   **tek RNG akışından** üretilir; sırası sabittir ve kayda girer. `config.bell`
   yoksa (eski snapshot) çan adımı hiç çizilmez — akış birebir aynı kalır.
3. Sunucu turu üretir, seed/sonuç zincirini hash'leyerek saklar → denetçi
   replay edebilir. İstemci sadece `SpinRound` verisini oynatır.

## Yol haritası

- [x] **Faz 1** — Matematik çekirdeği (RNG, şerit, değerlendirme, sim harness)
- [x] **Faz 2** — Bonus mekaniği (Link respin + Free spins) ve **RTP kalibrasyonu → %96**
- [x] **Faz 3** — Otoriter spin endpoint'i + cüzdan (BET/WIN ledger, idempotency, replay denetimi)
- [x] **Faz 4** — Phaser istemcisi (reel animasyonları, Link/FS bonus sahneleri, HUD)
- [x] **Faz 5** — Property-based test + CI RTP kapısı + sertifikasyon hazırlığı
- [x] **Faz 6** — Telemetri, config versiyonlama, yayın (`npm run release`, `docs/DEPLOYMENT.md`)
- [x] **Faz 7** — CERTIFICATION §7 boşlukları: entropi sağlığı, `doctor`, sorumlu oyun limitleri, WORM export, hesap/KYC
- [x] **Faz 8** — Prosedürel ses (8 WAV), otomatik dönüş (10/25/50), görsel iyileştirme (bg/kart/kazanç parıltısı)
- [x] **Faz 9** — Jackpot 5 kademe (Mini→Grand, bahis orantılı), her normal spine 1/10.000 şanslı düşüş, prize bar + kalibrasyon (kapı %96.22)
- [x] **Faz 10** — Çan respin bonusu (5+ çan → 3 hak, yeni çanda reset, 15 dolu → ×3, jackpot-kadeli çanlar), ayrı ikinci Hold & Win + kalibrasyon (kapı %95.95)

### Demo istemci notları

- Tur kaynağı **yalnızca** `POST /api/spin`'dir (`src/lib/api-client.ts`);
  yerel motor/simülasyon istemciden tamamen kaldırıldı (`demo-round.ts` silindi).
- Bakiye sunucudur: açılışta `GET /api/state`, tur sonunda spin yanıtının
  `pendingBalance`'ı settle anında görünür olur → **sayfa yenilense de kalıcı**.
- `/?force=link` · `/?force=fs` · `/?force=jackpot` · `/?force=bell` →
  bonus/düşüş zorlar
  (animasyon QA'sı için; jackpot araması 1/10.000 olduğundan geniş pencerede
  seed seçilir).
  İzin sunucuda: dev'de açık, `npm start`'te `SLOT_ALLOW_FORCE=1` gerekir;
  gerçek para modunda bonusu **sunucu** belirler.
- Smoke test: `window.__game` (store) ve `window.__phaser` (döngü dondurma)
  debug kancaları yalnızca demo içindir.
