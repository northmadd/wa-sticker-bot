# northmadbot

WhatsApp bot berbasis Node.js + Baileys dengan command:

- `.menu`
- `.ping`
- `.sticker` / `.s`
- `.brat <text>`
- `.bratvid` (maks 10 detik)

Requirement minimum: Node.js 20+

## 1) Jalankan di Windows

```bash
npm install
npm run setup
```

Lihat QR:

```bash
pm2 logs northmadbot
```

## 2) Jalankan di VPS Linux (disarankan 24/7)

Di folder project:

```bash
chmod +x deploy-linux.sh
./deploy-linux.sh
```

Atau manual:

```bash
npm install
npm run setup
```

## 3) Deploy ke Railway via GitHub

1. Pastikan code sudah ada di repo GitHub kamu.
2. Di Railway, buat project baru.
3. Pilih `Deploy from GitHub repo`.
4. Pilih repo: `northmadd/wa-sticker-bot`.
5. Tambahkan Volume Railway, mount path: `/data`.
6. Tambahkan variables:
   - `BOT_NAME=northmadbot`
   - `PREFIX=.`
   - `DATA_DIR=/data`
7. Deploy, lalu buka logs service Railway.
8. Scan QR yang muncul di logs (sekali saja).

Kalau QR kepotong di panel logs, aktifkan pairing code:

- `USE_PAIRING_CODE=true`
- `PAIRING_NUMBER=62xxxxxxxxxxx` (format internasional tanpa `+`)

Lalu redeploy. Bot akan tampilkan kode pairing di logs.

Contoh push code ke repo kalau local kamu belum terhubung:

```bash
git init
git add .
git commit -m "init northmadbot"
git branch -M main
git remote add origin https://github.com/northmadd/wa-sticker-bot.git
git push -u origin main
```

## Catatan nomor WhatsApp

Nomor bot adalah nomor WhatsApp yang kamu pakai scan QR pertama kali.
Jika di Railway pakai Volume `/data`, session akan persisten di `/data/session`.
