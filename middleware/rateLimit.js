// middleware/rateLimit.js — Wiring Express konkret di atas lib/rateLimiter.js
// (Phase 3C-4: security hardening).
//
// Mengikuti pembagian tanggung jawab yang sama seperti lib/session.js vs
// middleware/auth.js: lib/rateLimiter.js cuma tahu soal "key + window + max
// -> boleh/tidak", TIDAK tahu apa-apa soal req/res/cookie/body. File ini yang
// menjembatani - baca req.ip & req.body di sini, panggil checkLimit(), lalu
// putuskan balas 429 atau next().
//
// Dipasang di POST /api/auth/login dan POST /api/auth/register SEBELUM
// validasi/bcrypt handler-nya sendiri jalan (lihat server.js) - supaya
// request yang sudah kena limit tidak usah lanjut menghabiskan waktu CPU
// untuk bcrypt (yang memang sengaja lambat, lihat lib/password.js) sama
// sekali.

const { checkLimit } = require('../lib/rateLimiter');
const { normalizeEmail } = require('../lib/user');

// --- loginRateLimiter: key = IP + email (dinormalisasi) ---
// Kenapa IP+email, BUKAN IP saja: kalau cuma IP, satu warnet/kantor/NAT yang
// banyak orangnya (semua keluar lewat IP publik yang sama) bisa saling
// "menghabiskan jatah" percobaan login orang lain yang sebenarnya tidak
// terkait sama sekali. Dengan IP+email, batasnya jadi "percobaan gagal ke
// SATU akun tertentu, dari SATU sumber tertentu" - lebih tepat sasaran
// menahan brute-force satu akun, tanpa mengunci semua orang di jaringan yang
// sama begitu satu orang salah ketik password berkali-kali untuk email lain.
//
// normalizeEmail() DIPAKAI ULANG dari lib/user.js (bukan ditulis ulang di
// sini) - supaya "aturan apa yang dianggap email yang sama" tetap KONSISTEN
// dengan yang dipakai endpoint login itu sendiri untuk mencari user di
// database. Kalau normalisasinya beda (misal di sini lupa .toLowerCase()),
// "User@Mail.com" dan "user@mail.com" akan dianggap key BERBEDA oleh rate
// limiter walau sebenarnya menyasar akun yang sama persis di database -
// percobaan brute-force tinggal disebar dengan variasi huruf besar/kecil
// email untuk menghindari limit.
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 5;

function loginRateLimiter(req, res, next) {
  // req.body.email SEHARUSNYA sudah string (divalidasi lagi di handler route
  // setelah ini) - tapi middleware ini jalan SEBELUM validasi itu, jadi bisa
  // saja menerima body yang aneh (email berupa angka/object/tidak ada sama
  // sekali, atau string yang isinya cuma whitespace). Request begini tetap
  // harus dapat SATU key rate-limit yang valid (bukan ikut menolak
  // request-nya sendiri - itu tetap tugas validasi di handler).
  const rawEmail = req.body?.email;

  // --- Phase 3C-4 (review ketiga): normalize DULU, baru cek kosong atau tidak ---
  // Percobaan sebelumnya cek "isValidEmailString" (typeof string && length > 0)
  // SEBELUM normalizeEmail() dipanggil - itu bikin celah: string yang isinya
  // CUMA whitespace (misal " ", "\t", atau spasi Unicode seperti NBSP)
  // punya `.length > 0` (jadi dianggap "valid" oleh cek lama), padahal
  // normalizeEmail() (yang men-trim) akan menghasilkan STRING KOSONG untuk
  // input seperti itu - balik lagi ke key ambigu `login:<ip>:` yang justru
  // ingin dihindari.
  //
  // Urutan yang benar: panggil normalizeEmail() DULU (kalau memang string),
  // baru tentukan "kosong atau tidak" dari HASIL normalisasinya - bukan dari
  // panjang string mentah sebelum di-trim. Ini persis pola yang sudah dipakai
  // handler login sungguhan (lihat pengecekan `email.trim().length === 0` di
  // server.js) - jadi "apa yang dianggap email kosong" konsisten di kedua
  // tempat, tidak ada dua definisi yang bisa berbeda.
  //
  // normalizeEmail() sendiri TIDAK diubah sama sekali - dipanggil hanya kalau
  // rawEmail memang string (menghindari TypeError kalau bukan string, sama
  // seperti sebelumnya), tapi sekarang HASIL-nya yang dicek kosong/tidak,
  // bukan input mentahnya.
  const normalizedEmail = typeof rawEmail === 'string' ? normalizeEmail(rawEmail) : '';

  // --- Pisahkan bucket "email valid" dari "email cacat" (termasuk whitespace-only) ---
  // - Email valid (hasil normalisasi TIDAK kosong) -> key `login:<ip>:<email>`,
  //   PERSIS seperti sebelumnya - brute-force nyata SELALU menyasar satu
  //   email target yang valid, jadi jalur ini TIDAK BERUBAH SAMA SEKALI.
  // - Email tidak valid (bukan string/kosong/HANYA whitespace/tidak dikirim)
  //   -> SEMUA jatuh ke SATU key yang sama: `login:malformed:<ip>` - namespace
  //   terpisah yang jelas menandakan "ini request cacat". Bucket ini tetap
  //   kena limit LOGIN_MAX_ATTEMPTS/LOGIN_WINDOW_MS yang sama - banjir
  //   request cacat dari satu IP tetap tertahan.
  const key = normalizedEmail.length > 0
    ? `login:${req.ip}:${normalizedEmail}`
    : `login:malformed:${req.ip}`;
  const result = checkLimit(key, { windowMs: LOGIN_WINDOW_MS, max: LOGIN_MAX_ATTEMPTS });

  if (!result.allowed) {
    // Retry-After (header standar HTTP) diisi dalam DETIK (bukan milidetik) -
    // itu satuan yang dipakai spesifikasi header ini. Math.ceil supaya client
    // tidak diberi tahu "boleh coba lagi" lebih awal dari yang sebenarnya
    // (dibulatkan ke ATAS, bukan ke bawah).
    res.set('Retry-After', String(Math.ceil(result.retryAfterMs / 1000)));
    return res.status(429).json({ status: 'error', message: 'Terlalu banyak percobaan login. Coba lagi nanti.' });
  }

  next();
}

// --- registerRateLimiter: key = IP saja (BUKAN IP+email) ---
// Bedanya dengan login: di register, email yang dikirim SELALU email BARU
// (kalau sudah terdaftar, endpoint-nya sendiri menolak dengan 409 - lihat
// server.js). Jadi keying berdasarkan email tidak masuk akal di sini -
// penyerang yang mencoba mendaftar berkali-kali tinggal mengganti-ganti
// email di setiap percobaan (gampang sekali, email belum tentu perlu valid/
// terverifikasi di titik ini) untuk selalu dapat key yang "baru" kalau
// keyingnya ikut email. Keying IP SAJA menahan pola itu: berapa pun email
// yang dicoba, tetap satu sumber (IP) yang sama kena limit.
const REGISTER_WINDOW_MS = 60 * 60 * 1000;
const REGISTER_MAX_ATTEMPTS = 10;

function registerRateLimiter(req, res, next) {
  const key = `register:${req.ip}`;
  const result = checkLimit(key, { windowMs: REGISTER_WINDOW_MS, max: REGISTER_MAX_ATTEMPTS });

  if (!result.allowed) {
    res.set('Retry-After', String(Math.ceil(result.retryAfterMs / 1000)));
    return res.status(429).json({ status: 'error', message: 'Terlalu banyak percobaan registrasi. Coba lagi nanti.' });
  }

  next();
}

module.exports = { loginRateLimiter, registerRateLimiter };
