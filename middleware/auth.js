// middleware/auth.js — Middleware `requireAuth`: pintu gerbang pertama untuk
// route yang butuh login (Phase 3C-3: otorisasi).
//
// Bedanya dengan lib/session.js: file itu cuma berisi MEKANISME sign/verify
// signature (tidak tahu apa-apa soal Express/req/res). File ini yang
// memakainya jadi middleware Express konkret - baca cookie dari request,
// panggil verify(), lalu putuskan request boleh lanjut atau ditolak 401.

const { db } = require('../db/database');
const { verify, COOKIE_NAME } = require('../lib/session');

// --- parseCookies: parser header Cookie manual, TANPA package cookie-parser ---
// Browser mengirim SEMUA cookie sekaligus dalam SATU header string, formatnya
// "nama1=nilai1; nama2=nilai2; nama3=nilai3" - dipisah oleh "; " (titik koma
// + spasi, walau spasinya tidak selalu konsisten ada, makanya di-trim di
// bawah). Function ini mem-parsing string mentah itu jadi object biasa
// `{ nama1: 'nilai1', nama2: 'nilai2', ... }` supaya gampang diakses lewat
// `cookies[COOKIE_NAME]` di bawah.
//
// Diekspor terpisah (bukan cuma dipakai internal di sini) supaya bisa
// di-unit-test sendiri lepas dari Express req/res - cuma butuh input string,
// output object, tidak butuh mock request sama sekali.
function parseCookies(cookieHeader) {
  const cookies = {};

  if (typeof cookieHeader !== 'string' || cookieHeader.length === 0) {
    return cookies;
  }

  const pairs = cookieHeader.split(';');

  for (const pair of pairs) {
    // Split di tanda "=" PERTAMA saja (bukan semua "=") - nilai cookie
    // (bagian setelah "=") secara valid BISA mengandung karakter "=" lagi
    // di dalamnya (misal setelah di-encode base64), jadi kalau di-split di
    // SEMUA "=" nilai seperti itu akan terpotong salah.
    const separatorIndex = pair.indexOf('=');
    if (separatorIndex === -1) {
      // Segmen tanpa "=" sama sekali (misal string kosong akibat trailing
      // "; ") - bukan pasangan nama=nilai yang valid, lewati saja.
      continue;
    }

    const name = pair.slice(0, separatorIndex).trim();
    const rawValue = pair.slice(separatorIndex + 1).trim();

    if (name.length === 0) {
      continue;
    }

    try {
      // decodeURIComponent: nilai cookie yang dikirim browser (lewat
      // document.cookie atau res.cookie() di server) bisa saja sudah di-
      // encode (misal karakter spasi/titik koma diubah jadi %XX) - didekode
      // balik di sini supaya nilai yang diterima kode kita sama seperti nilai
      // asli sebelum di-encode.
      cookies[name] = decodeURIComponent(rawValue);
    } catch {
      // decodeURIComponent bisa throw kalau isinya sequence %-encoding yang
      // rusak/tidak valid (misal cookie yang sengaja dirusak orang iseng).
      // Daripada bikin request ini crash 500 gara-gara satu cookie yang aneh,
      // simpan apa adanya (tanpa decode) - toh kalaupun ini COOKIE_NAME kita,
      // verify() di bawah tetap akan menolaknya sebagai signature tidak valid.
      cookies[name] = rawValue;
    }
  }

  return cookies;
}

// --- requireAuth: middleware Express, dipasang di route yang WAJIB login ---
// Dipakai dengan cara diselipkan sebelum handler route, misal:
//   app.post('/api/products', requireAuth, requireAdmin, (req, res) => {...})
// Express menjalankan middleware berurutan dari kiri ke kanan - requireAuth
// jalan duluan, cuma lanjut ke requireAdmin/handler kalau requireAuth
// memanggil next() (bukan mengirim response sendiri).
function requireAuth(req, res, next) {
  const cookies = parseCookies(req.headers.cookie);
  const signedValue = cookies[COOKIE_NAME];

  const verified = verify(signedValue);

  if (!verified) {
    // Cookie tidak ada sama sekali ATAU signature-nya tidak valid (dipalsukan/
    // rusak/kadaluarsa dari sesi lama yang secret-nya sudah beda) - dua-duanya
    // diperlakukan SAMA: 401, tanpa membedakan pesannya, supaya tidak
    // membocorkan informasi soal KENAPA tepatnya ditolak (mirip semangat anti-
    // enumeration di POST /api/auth/login).
    return res.status(401).json({ status: 'error', message: 'Anda harus login untuk mengakses resource ini' });
  }

  // verify() sekarang balikin { userId, tokenVersion } (bukan userId polos) -
  // tokenVersion dibutuhkan di bawah untuk cek revocation, lihat komentar di
  // sana.
  const { userId, tokenVersion } = verified;

  // --- Kenapa user di-query ULANG dari database, bukan cukup percaya userId dari cookie ---
  // Cookie yang sudah lolos verify() di atas TERBUKTI memang ditandatangani
  // oleh server ini (bukan dipalsukan) - tapi itu cuma membuktikan SATU hal:
  // "ini benar id user sekian". Cookie ini TIDAK PERNAH dipakai untuk membawa
  // data lain seperti role/status akun, karena data seperti itu bisa SAJA
  // sudah berubah sejak cookie ini di-sign saat login dulu:
  // - Kalau akun user ini sudah DIHAPUS dari database sejak login (misal oleh
  //   admin), cookie lama miliknya tetap akan lolos verify() (signature-nya
  //   toh tetap valid secara matematis) - TANPA query ulang ke database di
  //   sini, user yang sudah dihapus itu akan tetap dianggap "authenticated"
  //   selamanya selama masih menyimpan cookie lamanya.
  // - Kalau role user ini DIUBAH (misal dari 'user' jadi 'admin', atau
  //   sebaliknya dicabut), perubahan itu harus langsung berlaku di request
  //   BERIKUTNYA, tidak boleh menunggu user itu login ulang dulu.
  // Query fresh ke database di setiap request memastikan requireAdmin di
  // middleware/authorize.js (yang jalan setelah ini) selalu mengevaluasi
  // role TERKINI, bukan role "seolah-olah" yang dibawa cookie.
  const user = db.prepare('SELECT id, email, role, token_version FROM users WHERE id = ?').get(userId);

  if (!user) {
    // userId di cookie valid secara signature, tapi baris user-nya sudah
    // tidak ada lagi di database (akun terhapus) - diperlakukan sama seperti
    // tidak login sama sekali, pesan/status SAMA PERSIS dengan kasus di atas.
    return res.status(401).json({ status: 'error', message: 'Anda harus login untuk mengakses resource ini' });
  }

  // --- Cek revocation: tokenVersion di dalam cookie harus cocok dengan token_version TERKINI ---
  // Ini mekanisme yang benar-benar membuat POST /api/auth/logout merevoke
  // sesi di sisi SERVER (lihat komentar panjang di db/database.js migrasi
  // 1c-2, dan di server.js POST /api/auth/logout). Cookie ini sudah TERBUKTI
  // asli dari server (lolos verify() di atas) DAN user-nya masih ada di
  // database (lolos cek di atas) - tapi itu belum cukup, karena signature
  // yang valid cuma membuktikan "token ini memang pernah di-sign oleh server
  // untuk user ini", bukan "token ini masih dianggap aktif SEKARANG". Kalau
  // tokenVersion yang tertanam di dalam cookie (nilai token_version SAAT
  // login dulu) tidak cocok lagi dengan token_version TERKINI di baris user
  // ini, artinya token ini di-sign SEBELUM logout terakhir (atau event
  // force-invalidation lain di masa depan) meng-increment token_version -
  // token ini sudah "basi" dan harus ditolak, PERSIS seperti "tidak login
  // sama sekali", dengan pesan/status yang SAMA PERSIS (tidak dibedakan) demi
  // prinsip yang sama seperti kasus-kasus 401 lain di file ini: tidak
  // membocorkan KENAPA tepatnya ditolak. Ini konsisten dengan alasan
  // requireAuth sudah query user FRESH dari database untuk role di atas -
  // token_version dicek dengan cara yang SAMA PERSIS (fresh per-request),
  // cuma kolom yang beda.
  if (user.token_version !== tokenVersion) {
    return res.status(401).json({ status: 'error', message: 'Anda harus login untuk mengakses resource ini' });
  }

  // req.user disiapkan di sini supaya middleware/route SETELAH requireAuth
  // (misal requireAdmin, atau handler route itu sendiri) tinggal baca
  // req.user.id/email/role tanpa perlu parsing cookie atau query database
  // lagi sendiri-sendiri.
  req.user = { id: user.id, email: user.email, role: user.role };
  next();
}

module.exports = { requireAuth, parseCookies };
