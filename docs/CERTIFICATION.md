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
| Üretim entropisi (BOŞLUK §7) | Sunucu seed'i `crypto.getRandomValues` (CSPRNG); laboratuvar onaylı DRBG/kaynak **üretim öncesi** bağlanacak | `rng.ts randomSeed()` |

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
| **Yayın zinciri** | `npm run release` | typecheck→lint→test→build→gate→audit tek komut; biri başarısızsa deploy durur (`docs/DEPLOYMENT.md`) |

- Kapının kapandığı da **kanıtlanmıştır**: yetersiz spin sayısı/beklenmeyen
  seed bant dışına çıkar → `exit 1` (negatif test koşuldu).
- Referans kalibrasyon: 20M spin → **%95.93** (`docs/CALIBRATION.md`).

## 7. Üretim öncesi bilinen boşluklar (Faz 6 + operasyon)

- [ ] **Entropi kaynağı**: laboratuvar onaylı RNG/DRBG kaynağı (şu an
      `crypto.getRandomValues` — CSPRNG, çoğu yargı için yeterli başlangıç,
      nihai karar laboratuvarındır).
- [ ] Hesap/KYC kimliği yerine cookie demo kimliği; gerçek oturum yönetimi.
- [ ] TLS zorunlu, `Secure` cookie (prod'da `NODE_ENV=production` ile zaten
      `Secure`; tam ortam doğrulaması yayın öncesi).
- [ ] Denetim loglarının WORM/uzak kopyaya akışı (yerel SQLite → prod'da
      append-only depolama/uzak kopya).
- [ ] Limitler ve sorumlu oyun kontrolleri (kayıp limiti, oturum süresi).
- [x] **Config sürümleme (Faz 6 — TAMAM)**: eski config snapshot'ları
      saklanır, R2 sürüm üzerinden replay eder; `config-versions.ts` +
      `config-versions.test.ts` + `docs/DEPLOYMENT.md §7` (snapshot'lar
      silinmez; yedekleme `.data/` ile birliktedir).
- [x] **Telemetri (Faz 6 — yerel TAMAM)**: `GET /api/telemetry`
      (süreç sayaçları + DB tüm-zamanlar + `configHash`),
      `GET /api/health` (yazmasız liveness). Uzak metrik shipper
      (Prometheus/loki) ortam eklentisi — bkz. `docs/DEPLOYMENT.md`.
