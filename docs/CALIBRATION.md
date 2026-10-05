# RTP Kalibrasyon Günlüğü

Hedef: **toplam RTP %96.00** · ölçüm: Monte Carlo simülasyon (`npm run sim`).

Her turda config tek bir veri dosyasında (`src/lib/engine/config.ts`)
değiştirildi, 500K–5M spin koşuldu, katkı payları ayrı ayrı okundu.

| Tur | Değişiklik | Toplam RTP | base | link | fs | Not |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | ilk config (paytable düşük, FS ×2/7, link w2) | **35.4%** | 27.5 | 3.8 (1/1171) | 3.5 (1/117) | featuresiz taban |
| 2 | link w2→3, scatter w1→2, paytable ×2, FS ×3/10 | **372.5%** | 76.2 | 5.3 | 291.0 (1/14) | ⚠️ scatter retrigger fırtınası |
| 3 | scatter w2→1 | **59.9%** | 46.6 | 2.0 (1/2119) | 11.3 (1/132) | link çok seyrek |
| 4 | paytable ×2 (mevcut), FS ×3/15, link stepCounts | **71.7%** | 55.6 | **0.0** | 16.1 | 🔴 eşit aralık `link`'i imkânsız kıldı |
| 5 | link w3→4 + spread kaldırıldı, FS ×3/20 | **79.1%** | 49.6 | 11.8 (1/350) | 17.7 | link mekanizması çalıştı |
| 6 | **both-ways açıldı** | **124.4%** | 84.0 | 12.2 | 28.2 | çok güçlü |
| 7 | paytable ×0.68, FS ×4 | **101.7%** | 59.8 | 13.5 | 28.4 | |
| 8 | FS ödül 15→13 | **94.8%** (1M) | 60.0 | 12.4 | 22.4 | hedefin biraz altı |
| 9 | link value ağırlıkları (ort. 1.585→1.625) | **96.18 / 95.54** (5M×2) | 59.8 | 12.5–12.8 | 23.3–23.6 | ✅ hedef oturdu |
| 10 | **Faz 9: jackpot 5 kademe + spin düşüşü** (spinChance 1/10.000, tablo tek kaynak, E=48×) | **96.221%** (2M kapı) | 59.780 | 12.507 | 23.383 | jackpot bileşeni **0.551%** (düşüş 1/9524); bant %0.15–0.75 kilitli |
| 11 | **Faz 10: çan respin bonusu eklendi** + link/bell jackpotChance %3→%2, bell values ort. 1.415×, bell stepCounts boş ağırlıklı | **95.945%** (2M kapı) | 59.784 | 10.700 | 23.238 | çan bileşeni **1.652%** (tetik 1/4049); bantlar yeniden kilitlendi ↓ |

**Tur 11 notu (Faz 10)**: Hold & Win tarzı **ikinci, BAĞIMSIZ bonus** eklendi:
gridde 5+ çan → 3 respin hakkı, her YENİ çan hakkı 3'e sıfırlar, 3 boş adımda
toplanan çanların bet-oranlı toplamı ödenir; 15 hücre dolarsa ödül ×3
(`fullMultiplier`); çanların içine %2 şansla jackpot-kadeli çan düşer
(ortak `jackpot.tiers` tablosu). İlk ölçüm (values/link aynısı + link
stepCounts) **99.269%** çıktı → çan + link birlikte ~3.3 puan aşıyordu.
Dengeleme: link.jp %3→%2 (−1.9 puan), bell.jp %3→%2 (−0.5), bell values
hafifletildi (−0.35), bell.stepCounts boş ağırlıklı yapıldı (tam doluluk
nadirleşir → ×3 "özel an" olur, ort. hücre 14.1→12.1). Kapı bantları
yeniden kilitlendi:

- **link %11–14 → %10–13**: respin bütçesi iki bonus arasında paylaşıldı
- **çan %1.1–2.4** (yeni bileşen bandı, ölçüm 1.652)
- **çan tetik 1/2000–8000** (yeni, ölçüm 1/4049 — şerit ağırlığı 2 sabit
  kaldı; ağırlık artırmak base bell paytablosunu da büyüttüğü için RTP
  bütçesini dağıtmak values/jp/stepCounts kollarıyla yapıldı)
- **max win 500–1300 → 500–2000×**: uç değer çan-full-grand çan bileşimiyle
  ~1684× (çan full ×3 + grand 500× hücresi) — tasarım gereği yeni tepe
- bileşen toplamı kontrolüne `bell` eklendi: `base+jackpot+link+bell+fs`

## Öğrenilen dersler (motor tasarımı için)

1. **Scatter ağırlığı hassastır**: 1→2 değişimi FS'yi 70 turda bire indirdi ve
   RTP'yi %372'ye uçurdu. Serbest ajanlı sim yapmadan tek sembol ağırlığı
   değiştirilmez.
2. **Eşit aralık (spread) her sembol için uygun değil**: nadir tetikleyicinin
   (link) makara başına 1'e inmesi 6+ tetiklemeyi imkânsız kılar → bonus hiç
   çalışmaz. Wild/scatter için faydalı, link için zararlı. Bunu garanti eden
   test: `config.test.ts → "grid EN AZ triggerCount link gösterebilmeli"`.
3. **both-ways ≈ +70% base RTP**: tek başına açmak hedefi %79'dan %124'e
   taşıdı; paytable tek yönlü modele göre **yeniden** ayarlanmalı.
4. **Katmanlı kalibrasyon**: önce base'i oturt, sonra FS, en sonda ince ayar
   (link value ağırlığı gibi ±0.3 puanlık kollar).
5. Ölçüm hatası: 500K spinde ±0.6 puan, 5M'de ±0.26 puan. Nihai doğrulama
   **iki bağımsız seed × 5M** ile yapıldı.

## Nihai config özeti

- Şerit ağırlıkları (toplam 32): cherry 6 · lemon 5 · orange 4 · grapes 4 ·
  watermelon 3 · seven 2 · bell 2 · wild 1 · scatter 1 · **link 4**
- both-ways: **açık** · 20 çizgi
- FS: 13/19/26 dönüş, **×4**, retrigger +5 (cap 50)
- Link: 6+ tetik, 3 hak, jackpotChance **%2**
- Çan (Faz 10): **5+ tetik, 3 hak (yenide 3'e sıfırlar), jackpotChance %2**,
  values ort. **1.415×** (0.5–10× arası, bet oranlı), stepCounts {0:45,
  1:30, 2:18, 3:7} (boş ağırlıklı → full nadir), **full ×3**, tetik ~1/4049
- Jackpot: **5 kademe tek tablo** — mini/minor/maxi/major/grand =
  10/20/50/100/500× (ağırlık 40/30/16/10/4, E=48×), **spinChance 1/10.000**
  (her normal spin; link/çan hücreleri ortak tabloyu kullanır)
- Kapı bantları (`npm run gate`, seed `rtp-gate-1`, 2M): toplam
  %95.40–96.60 · base %57.5–62.0 · **jackpot %0.15–0.75** · link **%10–13** ·
  **çan %1.1–2.4** · fs %22–25.5 · hit %45–49 · link 1/280–430 ·
  **çan 1/2000–8000** · fs 1/115–175 · **max win 500–2000×** · σ 4.0–7.5
