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
- Link: 6+ tetik, 3 hak, jackpotChance %3, mini/minor/major/grand = 10/20/100/500×
