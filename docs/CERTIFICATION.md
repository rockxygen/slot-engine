# Sertifikasyon Hazırlığı — Kontrol Haritası (Faz 5)

> Bu doküman, **lisanslı gerçek para** hedefi için bağımsız laboratuvar
> (GLI-19 tipi) denetimine hazırlık özelliğidir; laboratuvar onayının
> **yerine geçmez**. Amaç: her gereksinimin hangi kontrollerle
> karşılandığını ve kanıtının nerede olduğunu izlenebilir (traceable)
> hâle getirmektir.

## 1. RNG ve determinizm

| Kontrol | Uygulama | Kanıt |
| --- | --- | --- |
| Deterministik, seed'li PRNG | sfc32 + xmur3, **salt 32-bit tamsayı aritmetiği** (`Math.imul`) → platform/derleyici bağımsız aynı zincir | `src/lib/engine/rng.ts` |
| Önyargısız örnekleme | `nextInt(max)` **red-detme örneklemesi** (mod alma bölsel önyargısı yok) | `rng.test.ts` + property: *"nextInt(max) her zaman [0,max) içinde"* |
| Durum kaydetme / geri yükleme | `rng.state()` → `createRng(seed, state)` **atlamadan** devam → replay'in temeli | property: *"kayıtlı durumdan devam = orijinal zincirin devamı"* |
| Seed genişletme | xmur3 (avalanche hash), isınma turu (16 adım) | `rng.ts` |
| Tur determinizmi | aynı `(seed, bet)` → JSON olarak birebir aynı `SpinRound` | property: *"aynı (seed, bet) → birebir aynı tur"* (200 örnek/tur) |
| Üretim entropisi | Sunucu seed'i **yalnızca** CSPRNG (`crypto.getRandomValues`); kaynağı yoksa seed üretmez → hata. Startup sağlık testi (sıfır/sabit/tekrar/monobit) başarısızsa oyun **oynatmaz** | `rng.ts randomSeed()` + `server/entropy.ts` (+ testleri). **Dış:** laboratuvar onaylı DRBG (§7) |

## 2. Tur üretimi ve replay denetimi

| Kontrol | Uygulama | Kanıt |
| --- | --- | --- |
| Tek RNG akışı | base → link → freeSpins **aynı akıştan**, sıra sabit | `round.ts` + `round.test.ts` |
| Sonuç kaydı (kanıt, sonuç değil) | `rounds` tablosu: `seed`, `sha256(round)`, `bet`, `win`, `balance_after` | `server/db.ts` şeması |
| Replay doğrulama | `verifyRound()` — seed'den yeniden üret + hash karşılaştır | `spin-service.test.ts`, `audit.ts` (R1) |
| Denetçi aracı | `npm run audit` → tüm turları replay eder, R1/R2/L1/L2/L3 raporu, exit kodu | `server/audit.ts` + `audit.test.ts` (bozuk seed/config/zincir/bağ **hepsi yakalanır**) |
| Yapısal bütünlük | `totalWin = base+link+fs`; link hücre toplamı; FS `result×çarpan`; hepsi **property test** ile rastgeel seed'lerde | `engine/properties.test.ts` |

## 3. Para bütünlüğü ve cüzdan ledger'ı

| Kontrol | Uygulama | Kanıt |
| --- | --- | --- |
| Tamsayı para | Tüm kazançlar minor birimde tamsayı; **lineBet katı** (kuruş kayması yok) | property: *"satır kazancı her zaman lineBet katıdır"* |
| Lineer bahis ölçeklemesi | `win(k·bet) = k·win(bet)` **tam eşitlik** — yuvarlama/parazit para kaçışı bu özelliği kırar | property: *"lineer bet ölçeklemesi"* (300 örnek) |
| Append-only ledger | `OPENING / BET / WIN / REFILL` satırları; `balance_after` denetim izi; oturum bazlı `SUM(amount) === balance` invariantı | `wallet.ts`, property: *"cüzdan durum makinesi"* (60 rastgeel op dizisi) |
| Atomik tur | BET → round → WIN **tek SQLite transaction**; hata → ROLLBACK, iz kalmaz | `spin-service.ts performSpin()` |
| İdempotency (double-bet yok) | `(session, client_request_id)` UNIQUE → aynı istek **replay**, ikinci bahis çekilmez; farklı bahis → 409 | `spin-service.test.ts`, property (5)–(6) |
| Başarısız işlem = iz yok | yetersiz bakiye/geçersiz bahis/kapalı force → dünya değişmez | property (5), `spin-service.test.ts` |

## 4. Sunucu otoritesi (istemcide matematik yok)

- Tur üretiminin **tek** kapısı `POST /api/spin` (`src/app/api/spin/route.ts`);
  istemci yalnızca `SpinRound`'ı oynatır (`api-client.ts` tek veri kaynağı;
  eski yerel `demo-round.ts` **silinmiştir**).
- Bakiye istemcide saklanıp **gösterilmez**; `GET /api/state` + spin yanıtı
  gelir, settle anında görünür (`game-store.ts pendingBalance`).
- Force (`?force=`) değeri istemciden gelse de **izni sunucuda**
  (prod'da `SLOT_ALLOW_FORCE=1` yoksa kapalı); kullanılan seed + `forced`
  işareti denetim kaydına düşer.

## 5. Konfigürasyon değişiklik kontrolü

1. Her round, oynandığı anki oyun verisinin parmak izini saklar
   (`rounds.config_hash = sha256(config)`).
2. Denetimde **R2**: round'ın config hash'i bu binary'ninki gibi olmalı
   **ya da** oynandığı sürümün snapshot dosyasıyla çözülebilmeli
   (`config-versions.ts` — her binary ilk turda kendi sürümünü
   `.data/config-versions/<hash>.json`'a yazar; içerik bütünlüğü dosya
   adıyla doğrulanır). **Snapshot yoksa → FAIL**; eski config ile
   sürüm replay'i **tamamlandı** (Faz 6, `config-versions.test.ts`:
   sahte/bozuksa R2, doğruysa R1+R2 geçer).
3. Matematik değişiklikleri `npm run gate` bantlarını geçmek **zorundadır**;
   bant bilinçli olarak güncellenir → değişiklik kontrolü izi.

## 6. Test kanıtı ve kapılar (hepsi CI'da, `.github/workflows/ci.yml`)

| Kapı | Komut | Ne korur |
| --- | --- | --- |
| Birim + property testler | `npm test` | RNG, değerlendirme, bonus, cüzdan, denetim motoru |
| Tip/lint/build | `npm run typecheck && npm run lint && npm run build` | sözleşme bütünlüğü |
| **RTP regresyon kapısı** | `npm run gate` | 2M spin (seed `rtp-gate-1`, deterministik): RTP **%95.40–96.60**, base/link/FS katkı bantları, hit %45–49, tetik frekansları, max win ≤1300×, σ bantları, bileşen toplamı ≡ RTP |
| Denetçi replay | `npm run audit` | gerçek DB üzerinde R1–L3 (config sürümü snapshot üzerinden, Faz 6) |
| **Yayın zinciri** | `npm run release` | typecheck→lint→test→build→gate→audit→doctor tek komut; biri başarısızsa deploy durur (`docs/DEPLOYMENT.md`) |
| **Ortam postürü** | `npm run doctor [-- --strict]` | NODE_ENV, force kapısı, cookie `Secure`, DB quick_check, snapshot yazılabilirlik, entropi sağlığı (Faz 7) |
| **Uzak kopya zinciri** | `npm run audit:export [-- --verify/--ship]` | hash-zincirli denetim dışa aktarımı; bozulma/sayım uyuşmazlığı `exit 1` (Faz 7) |

- Kapının kapandığı da **kanıtlanmıştır**: yetersiz spin sayısı/beklenmeyen
  seed bant dışına çıkar → `exit 1` (negatif test koşuldu).
- Referans kalibrasyon: 20M spin → **%95.93** (`docs/CALIBRATION.md`).

## 7. Üretim öncesi bilinen boşluklar (Faz 6–7 + operasyon)

> İşaret = **kod tarafı tamam ve test edildi**. Yanında "dış" yazan kısım
> altyapı/laboratuvar/sağlayıcı işidir — bu depoda yapılmaz ama mekanizma
> hazır ve koddan doğrulanır. Kapıların çoğu: `npm run doctor` (ortam) ve
> `npm run release` (tüm zincir).

- [x] **Entropi kaynağı (Faz 7 — kod TAMAM)**: `randomSeed()` yalnızca
      CSPRNG — `getRandomValues` yoksa **hata fırlatır** (zayıf kaynağa
      sessiz düşüş yok, `rng.test.ts`). Startup sağlık testi
      (`entropy.ts`: sıfır/sabit/tekrar/monobit — zayıf kaynak senaryoları
      testte yakalanır); başarısızsa `performSpin` yeni tur üretmez
      (`503 rng_unhealthy`), `/api/health` raporlar. **Dış kalan:**
      laboratuvar onaylı DRBG kararı.
- [x] **Hesap/KYC (Faz 7 — mekanizma TAMAM)**: `players` tablosu +
      scrypt parola (`accounts.ts`, timingSafeEqual), register/login/logout
      uçları, oturum→oyuncu bağı, `kyc_status` **kapısı** — `pending`/
      `rejected` oyuncu tur oynayamaz (`403 kyc_required`, iz bırakmaz);
      `SLOT_REQUIRE_KYC=1` ile anonim oyun tamamen kapanır (lisanslı
      yayında bu açık olmalı). KYC onayının kendisi sağlayıcı webhook'u
      → `setKycStatus` ile girer (`POST /api/auth/kyc` demo stub'ı).
      **UI hazır** (HUD: giriş/kayıt + KYC rozeti, `account-panel.tsx`;
      engelde ilgili panel otomatik açılır). **Dış kalan:** KYC sağlayıcısı.
- [x] **TLS / Secure cookie (Faz 7 — ölçüm TAMAM)**: `npm run doctor`
      üretim postürünü **kodla ölçer** (NODE_ENV, force kapısı kapalı mı,
      cookie `Secure` aktif mi, DB quick_check, snapshot yazılabilirlik,
      entropi); `--strict` deploy kapısı → `exit 1`. **Dış kalan:** TLS
      sonlandırması (ters proxy, `docs/DEPLOYMENT.md §5`).
- [x] **WORM / uzak kopya (Faz 7 — mekanizma TAMAM)**: `npm run
      audit:export` → hash-zincirli JSONL (satır ekleme/silme/değiştirme
      zinciri kırar; header sayımı otomatik ekleme de tutmaz), `--verify`
      zinciri yeniden hesaplar, `--ship` + `SLOT_AUDIT_SINK` ile uzak
      uç noktaya akar (gerçek HTTP testi var). **Dış kalan:** zamanlanmış
      kopya (cron/Zamanlayıcı) + imzalama/uzak depo.
- [x] **Sorumlu oyun limitleri (Faz 7 — zorlama TAMAM)**: kayıp / ciro /
      oturum süresi limitleri **sunucuda** `performSpin` öncesi zorlanır
      (`403 limit_exceeded`, hangi limit olduğu mesajda; ihlalde iz yok),
      `GET/PUT /api/limits` ile görüntüleme/ayar; **HUD paneli hazır**
      (Limitler paneli: kullanım özeti + ₺/dk formları). **Kalan:** hesap
      açılışında zorunlu limit varsayılanları (ürün kararı).
- [x] **Config sürümleme (Faz 6 — TAMAM)**: eski config snapshot'ları
      saklanır, R2 sürüm üzerinden replay eder; `config-versions.ts` +
      `config-versions.test.ts` + `docs/DEPLOYMENT.md §7` (snapshot'lar
      silinmez; yedekleme `.data/` ile birliktedir).
- [x] **Telemetri (Faz 6 — yerel TAMAM)**: `GET /api/telemetry`
      (süreç sayaçları + DB tüm-zamanlar + `configHash`),
      `GET /api/health` (yazmasız liveness + entropi durumu). Uzak metrik
      shipper (Prometheus/loki) ortam eklentisi — bkz. `docs/DEPLOYMENT.md`.
