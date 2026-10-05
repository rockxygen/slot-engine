# Yayın / Operasyon Runbook'u (Faz 6)

Bu belge tek bir Next.js sürecini **üretimde** çalıştırmak içindir.
Sertifikasyon kontrol haritası: `docs/CERTIFICATION.md`.

## 1. Yayın öncesi ön kapı

Her yayın dalı (`master`) şu zincirden geçmeden deploy edilmez:

```bash
npm run release
# = typecheck && lint && test && build && gate && audit
```

| Kapı | Ne korur |
| --- | --- |
| `typecheck` / `lint` / `test` | sözleşme, mantık, property + telemetri + config-sürüm testleri (87+) |
| `build` | üretim derlemesi |
| `gate` | **RTP regresyon kapısı** — 2M deterministik spin, bantlar (CI'da `exit 1` kanıtlanmış) |
| `audit` | canlı `.data/slot.db` üzerinde R1–L3 denetimi (replay + config sürümü + ledger) |

CI (`.github/workflows/ci.yml`) aynı zinciri koşar; kapıların kapandığı da
negatif testlerle kanıtlanmıştır.

## 2. Ortam değişkenleri

Kopyalanabilir şablon: `.env.example`

| Değişken | Varsayılan | Not |
| --- | --- | --- |
| `SLOT_DB_PATH` | `.data/slot.db` | Denetim DB'si. **Mutlaka sabit, yedeklenen bir yolu olsun.** WAL açık. |
| `SLOT_CONFIG_VERSIONS_DIR` | `.data/config-versions` | Config sürüm snapshot'ları (aşağıya bkz.). **Silinmez; sadece eklenir.** |
| `SLOT_ALLOW_FORCE` | kapalı | `?force=` QA kapısı. `NODE_ENV=production`'da yalnızca `1` ile açılır — **lisanslı yayında asla `1` yapılmaz.** |
| `NODE_ENV` | `production` | `npm start` zorlar; cookie `Secure` bundan doğar. |

## 3. Yayın adımları

```bash
git pull && npm ci
npm run release          # tüm kapılar yeşil değilse DUR
npm start                # http://localhost:3000 (NODE_ENV=production)
```

Yayın sonrası **zorunlu doğrulama** (3 istek):

```bash
curl -fsS localhost:3000/api/health
# {"ok":true,"db":"ok","configHash":"<64 hex>","uptimeSec":N}

curl -fsS localhost:3000/api/telemetry   # allTime.*, process.*, configHash
npm run audit                            # kapı hâlâ yeşil mi? (kapıdan sonra yeni tur yazılmışsa)
```

`health.configHash` yayınlanan **canlı matematik** parmak izidir; deploy
kayıtta (release notu, CI logu) beklenen hash ile karşılaştırılır.
`health` **yazma yapmaz** (session açmaz) → yük dengeleyici liveness için güvenlidir.

## 4. Süreç yönetimi

`npm start` ön planda; üretimde süreç çökünce kendini yeniden başlatmalı:

- **Windows**: [NSSM](https://nssm.cc) ile servise çevirme ya da Task Scheduler
  (başlangıçta, hata durumunda yeniden başlat).
- **Linux**: systemd `Restart=always` ya da PM2: `pm2 start npm --name slot -- start`.

Tek process yeterlidir: durum `.data/slot.db`'dedir, bellekte değildir
(yeniden başlatma = oturumlar/bakiyeler korunur; yalnızca `process`
telemetri sayaçları sıfırlanır — `allTime` DB'den gelir, etkilenmez).

## 5. Ters proxy / TLS

Uygulama TLS sonlandırmaz; örneğe nginx:

```nginx
server {
  listen 443 ssl;
  server_name slot.example.com;
  ssl_certificate     /etc/ssl/certs/slot.pem;
  ssl_certificate_key /etc/ssl/private/slot.key;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

- Cookie `Secure` üretimde açıktır; **HTTPS zorunlu** (kredili oyun).
- `telemetry` demo'da herkese açıktır — üretimde bu yolu auth/proxy
  katmanında kapatın veya ağ geçidi arkasında tutun (sayılar hassastır).

## 6. Yedekleme ve geri dönüş

**Yedek (WAL'li SQLite):**

1. Yeni tur yazılmayacak bir an seçin (veya süreci durdurun).
2. `wal_checkpoint(TRUNCATE)` ile WAL'i ana dosyaya katın
   (ör. `node -e` ile `node:sqlite` veya süreç durdurulmuşken `.data/` klasörünü kopyalayın).
3. `.data/slot.db` + `.data/config-versions/` birlikte kopyalanır —
   **ikisi aynı yedeğin parçasıdır** (tur = config dosyası olmadan replay edilemez).

**Doğrulama:** kopyayı geçici `SLOT_DB_PATH` ile `npm run audit` → hepsi PASS.

**Geri dönüş:** `git revert` → `npm run release` → `npm start`.
DB şeması uyumsuzsa revert yalnızca kodla kalmaz; şema değişikliği eklendiyse
(Faz 6'da eklenmedi) geri dönüş notu belgeye yazılır.

## 7. Config versiyonlama (denetim sürekliliği)

Her binary **ilk turda** kendi oyun verisinin snapshot'ını
`.data/config-versions/<configHash>.json` dosyasına yazar; dosya adı =
içeriğin sha256'sı (bütünlük yüklemede doğrulanır).

Kural: config değişince **eski dosya yerinde kalır** — yeni binary eski
turları bu dosyayla replay eder. `npm run audit` (R2) eski sürüm snapshot
bulamazsa **FAIL** eder: yani denetim zinciri, eski snapshot'ı silen
herkes için kırılır.

- Snapshot'ları **silinmez, yalnızca eklenir** (değişiklik kontrolünün parçası).
- Test/CI kirlenmesini önlemek için testler `SLOT_CONFIG_VERSIONS_DIR`'i
  geçici dizine çevirir.

## 8. Telemetri

`GET /api/telemetry` iki katman:

- `process` — bu sürecin sayaçları (tur, bonus tetikleri, reddetmeler,
  süreç RTP'si; yeniden başlatmada sıfırlanır).
- `allTime` — denetim DB'sinden (round/sessions tabloları): rounds,
  forcedRounds, bet/win toplamı, RTP, son tur zamanı.
- `configHash` — canlı matematiğin parmak izi (health ile aynı).

Operatör bakışı: `allTime.rtp` uzun vadede `docs/CALIBRATION.md`
bantlarını (gate bantları) izlemelidir; sapma kalibrasyon incelemesi
(bkz. `docs/CALIBRATION.md` değişiklik kontrolü) demektir.

## 9. Bilinen boşluklar

Lisanslı/gerçek para öncesi kalanlar: `docs/CERTIFICATION.md` §7
(entropi kaynağı, hesap/KYC, WORM uzak kopya, sorumlu oyun limitleri).
