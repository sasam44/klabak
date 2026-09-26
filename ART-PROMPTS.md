# Klabak — lembar prompt seni

Tujuan: mengubah tampilan dari "SVG bersih" jadi **kartun/animasi 3D** tanpa kehilangan
kejernihan UI, tanpa menambah beban muat halaman, dan tanpa melanggar aturan juri
("no AI slop — AI untuk kode/aset boleh, tapi butuh selera").

## Blok gaya bersama (tempel di SETIAP prompt)

```
STYLE: hand-painted 3D cartoon look, soft thick rim light, glossy plastic + brushed
metal materials, gentle cel shading, cinematic teal-and-gold neon palette —
deep navy #141029, teal #5FD0C5, periwinkle #7D8BFF, warm gold #FFCD6B, magenta
accents; subtle film grain; premium indie game craft (Hades / Ori level of polish,
NOT a stock 3D render); no text, no letters, no numbers, no logos, no watermark,
no signature, no people; centered composition; crisp silhouette; high detail
```

**Negative prompt (semua gambar):** `blurry, jpeg artifacts, extra limbs, holographic
text, watermark, signature, UI screenshot, photorealistic human, cluttered background,
harsh flash, oversaturated rainbow, purple gradient blob, generic stock art`

## Palet acuan (ambil warna dari sini, jangan improvisasi)

| Peran | Hex |
| --- | --- |
| Latar gelap | `#0d0b17` / `#141029` |
| Panel | `rgba(255,255,255,0.035)` + garis `rgba(244,241,255,0.10)` |
| Teal (charm langka 1) | `#5FD0C5` |
| Periwinkle (charm langka 2) | `#7D8BFF` |
| Emas (jackpot / aksen) | `#FFCD6B` |
| Zonk / TILT | `#FF7A8A` |
| Teks | `#f4f1ff` · redup `#a9a2c9` · samar `#6f688f` |

---

## 1. Background ruang arcade

**Ukuran:** 1920×1080 (dipakai sebagai latar halaman, digelapkan otomatis + overlay)

```
Wide straight-on interior of a tiny Japanese-style arcade hall at night, seen from
the player's side of the room: dark navy walls, a receding row of glowing gachapon
capsule machines on both sides, wet polished floor with long teal and gold neon
reflections, hanging paper lanterns the same warm gold, soft magenta haze in the far
distance, volumetric light shafts, shallow depth of field so the middle stays soft,
edges very dark so white UI text stays readable on top, cinematic 16:9, no characters,
no signage lettering.
STYLE + negative as above.
```

## 2. Badan mesin gachapon

**Ukuran:** ~1400×1000, lalu background dihapus (kunci magenta) → PNG transparan

```
Front orthographic view of one retro gachapon capsule machine cabinet, full cabinet
visible with generous margin: dark navy (#141029) metal body, brushed-metal edge trim,
tiny rivets, warm gold (#FFCD6B) accent lines, a large EMPTY glass tank in the middle
(clear glass with a soft blue sheen and a bright specular highlight, nothing inside),
a chrome horizontal rail across the top of the glass, a coin plate with a lever on the
front, a prize chute opening at the bottom right, a marquee frame along the top with
round unlit bulbs, small teal indicator lights on the panel, soft contact shadow under
the cabinet.
Isolated on a perfectly flat solid magenta background (#FF00FF) for background removal,
no other background elements, even studio lighting, sharp silhouette.
STYLE + negative as above.
```

## 3. Capit (gripper)

**Ukuran:** ~900×900, kunci magenta → PNG transparan

```
A single arcade claw-machine gripper, isolated object, hanging straight down: chrome
metal hub with visible screws and a small servo box, THREE curved steel prongs with
dark rubber tips, brushed metal with a few subtle scratches, warm gold trim ring,
strong specular highlights, soft ambient occlusion where the prongs meet the hub,
a short cable stub at the top cut cleanly.
Isolated on a perfectly flat solid magenta background (#FF00FF) for background removal,
front view, centered, sharp silhouette.
STYLE + negative as above.
```

## 4. Bola gacha (kapsul)

**Ukuran:** ~800×800, kunci magenta → PNG transparan

```
A single gachapon toy capsule, front view, centered: two-piece glossy plastic capsule,
teal (#5FD0C5) lower shell and a milky translucent white top cap, a thin dark seam line
around the middle, a small flat tab on top, one strong soft-box highlight along the
upper-left, a soft round contact shadow at the bottom, product-shot clarity, slight
subsurface glow inside the cap so it looks like it holds something.
Isolated on a perfectly flat solid magenta background (#FF00FF) for background removal,
no other objects, sharp clean silhouette.
STYLE + negative as above.
```

## 5. (opsional) Lembar 12 charm hadiah

Satu lembar 4×3, tiap sel satu objek, gaya sama, latar magenta:

```
A neat 4 by 3 grid sheet of twelve separate tiny toy charms, each isolated in its own
cell with even spacing, all in the same hand-painted 3D cartoon style: tin robot,
glass cat, porcelain swan, neon jelly, crystal fox, golden koi, obsidian beetle,
ivory idol, sunken crown, plus three filler trinkets. Each object glossy, small,
charming, clearly readable at thumbnail size. Flat solid magenta background (#FF00FF)
so each cell can be cut out. No text, no labels, no grid lines.
```

---

## Cara pakai di game

| Aset | Penempatan | Catatan teknis |
| --- | --- | --- |
| Background arcade | `body` latar + overlay gelap | dijaga ≤ 250 KB, di-`preload`; UI tetap kontras |
| Badan mesin | dekorasi/idle + kartu share | sprite tidak bisa "membuka" capit — mesin tetap SVG untuk animasi |
| Capit | kepala gripper sprite + prong SVG yang tetap membuka/menutup | hibrida: realistis tapi masih bisa beranimasi |
| Bola gacha | menggantikan kapsul SVG | satu sprite untuk semua (kapsul memang identik); warna kabinet lewat `hue-rotate` |
| Charm | chip di panel SHELF | opsional, dikerjakan terakhir |

**Aturan yang tidak boleh dilanggar oleh perubahan seni:**
1. Kapsul tetap identik satu sama lain — tidak boleh ada yang terlihat "kosong" atau "berisi".
2. Jumlah kapsul yang bisa diambil tetap enam, semuanya ada di baris capit.
3. Bacaan `PRIZE ×… · <charm>` / `SLIP · NO PRIZE` di plat tengah tetap jadi sumber kebenaran.
4. Halaman tetap muat tanpa zoom dan tetap cepat (aset ditambah maksimal ±0,3 MB total).
