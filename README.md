# 🍀 Clover Link Bells — Slot Engine

Clover Link tarzı (klasik meyve + Link respin bonusu) slot oyununun **matematik
motoru** ve Next.js 16 sarmalayıcısı. Hedef: **gerçek para / lisanslı** kullanım
(GLI-19 tipi RNG denetimine hazır yapı).

> Motor **saf TypeScript**'tir — sunucuda sonuç üretir, istemci yalnızca
> oynatır. Client'ta hiçbir matematik yoktur.

## Komutlar

```bash
npm run dev        # Next.js geliştirme sunucusu
npm test           # Vitest (149 test: RNG, motor, bonus, cüzdan, property, denetim, telemetri, limit, KYC, ses, UI)
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
  round.ts               # playRound(): base → link → freeSpins orkestrasyonu
  simulate.ts / sim-cli  # Monte Carlo RTP harness'i (kalibrasyon aracı)
  *.test.ts              # 47 test

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
- **Force QA kapısı**: `?force=link|fs` değeri istemciden gelir ama izni
  sunucuda — development'ta açık, production'da yalnızca `SLOT_ALLOW_FORCE=1`.
  Kullanılan seed (`force-link-92` gibi) ve `forced` işareti kayda düşer.

## Regresyon kapıları ve property testler (Faz 5)

- **Property-based test** (fast-check): tek örnek değil, rastgeel girdi
  uzayı zorlar — determinizm, `totalWin = base+link+fs` kompozisyonu,
  **lineer bahis ölçeklemesi** (`win(k·bet) = k·win(bet)` tam eşitlik —
  para kaçırıcı her yuvarlama hatası bu özelliği kırar), tamsayı/lineBet
  katı para, link hücre toplamı, FS `result×çarpan`, RNG durum
  geri yükleme (replay temeli) ve **cüzdan durum makinesi** (rastgeel
  spin/refill/idempotency dizilerinde ledger invariantı her adımda).
- **RTP kapısı**: `npm run gate` → 2M spin, seed `rtp-gate-1`
  (deterministik = tekrarlanabilir); bantlar kalibrasyonla kilitli
  (RTP %95.40–96.60, katkılar, hit, tetik frekansları, max win, σ).
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
  tur, link/FS tetikleri, reddetmeler, süreç RTP'si) + `allTime`
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
- [x] **Faz 5** — Property-based test + CI RTP kapısı + sertifikasyon hazırlığı
- [x] **Faz 6** — Telemetri, config versiyonlama, yayın (`npm run release`, `docs/DEPLOYMENT.md`)
- [x] **Faz 7** — CERTIFICATION §7 boşlukları: entropi sağlığı, `doctor`, sorumlu oyun limitleri, WORM export, hesap/KYC
- [x] **Faz 8** — Prosedürel ses (8 WAV), otomatik dönüş (10/25/50), görsel iyileştirme (bg/kart/kazanç parıltısı)

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
