// lib/password.js — Logic hashing & verifikasi password, dipisah dari route.
//
// Ini folder lib/ pertama di project ini (sebelumnya cuma ada db/ untuk
// database dan route langsung di server.js). Alasan dipisah ke sini: fungsi
// hash & verify password akan dipakai di DUA tempat berbeda nanti - endpoint
// register (hash password baru) DAN endpoint login (verify password yang
// diketik user) di Phase 3C-2. Kalau logic ini ditulis langsung di dalam
// route, jadi ke-copy-paste dua kali dan gampang beda perlakuan (misal lupa
// update salah satu tempat kalau ada perbaikan). Ditulis sekali di sini,
// dipakai ulang (reusable) di kedua endpoint nanti.

const bcrypt = require('bcrypt');

// SALT_ROUNDS = "seberapa banyak kerja keras" bcrypt buat nge-hash satu
// password (makin tinggi, makin lambat tapi makin susah di-brute-force).
// 12 dipilih sebagai keseimbangan keamanan vs kecepatan (sudah diputuskan
// di architecture review): cukup berat untuk bikin brute-force mahal, tapi
// masih cepat untuk satu request login/register (hitungan ratusan ms, bukan
// detik). Angka ini BUKAN secret - aman ditulis langsung di kode (bukan di
// .env), karena "kesulitan"-nya bcrypt datang dari hashing yang lambat itu
// sendiri, bukan dari angka round-nya dirahasiakan.
const SALT_ROUNDS = 12;

// bcrypt punya batas efektif 72 byte pada input password: karakter setelah
// byte ke-72 DIAM-DIAM diabaikan (tidak error, tidak warning). Kalau tidak
// dicek di sini, ini jadi silent bug yang aneh nanti: user daftar dengan
// password 80 karakter, tapi yang benar-benar "dianggap" cuma 72 byte
// pertamanya - user tidak akan pernah tahu sisa passwordnya percuma.
// Makanya kita TOLAK secara eksplisit (throw error jelas) daripada
// membiarkan bcrypt memotongnya diam-diam.
//
// Catatan: validasi panjang MINIMUM password (misal minimal 8 karakter)
// BUKAN tanggung jawab fungsi ini - itu urusan endpoint register nanti
// (Phase 3C-2), supaya file ini tetap fokus satu tanggung jawab: hashing
// & verifikasi, bukan aturan bisnis soal seberapa kuat password harus.
function assertPasswordByteLengthWithinLimit(plainPassword) {
  // Jaga-jaga: kalau nanti endpoint register (3C-2) salah kirim (misal
  // `req.body.password` ternyata undefined/null/angka karena field-nya lupa
  // divalidasi dulu), tanpa cek ini `Buffer.byteLength` akan melempar
  // TypeError bawaan Node yang teksnya generic ("The \"string\" argument
  // must be of type string...") - jauh lebih jelas kalau ditolak di sini
  // dengan pesan yang langsung nunjuk ke masalahnya: password harus string.
  if (typeof plainPassword !== 'string') {
    throw new TypeError('Password harus berupa string.');
  }
  const byteLength = Buffer.byteLength(plainPassword, 'utf8');
  if (byteLength > 72) {
    throw new Error(
      `Password terlalu panjang (${byteLength} byte). Maksimal 72 byte karena batas efektif algoritma bcrypt - karakter setelah itu akan diam-diam diabaikan kalau tidak ditolak di sini.`
    );
  }
}

// Hash password mentah (plaintext) jadi string hash yang aman disimpan ke
// kolom `password_hash` di table users. Dipanggil sekali saat register.
async function hashPassword(plainPassword) {
  assertPasswordByteLengthWithinLimit(plainPassword);
  return bcrypt.hash(plainPassword, SALT_ROUNDS);
}

// Cek apakah password yang diketik user (plaintext, misal saat login) cocok
// dengan hash yang tersimpan di database. Pakai `bcrypt.compare`, BUKAN
// `===` manual (misal `plainPassword === hash`) - dua alasan:
// 1. Hash-nya memang tidak akan pernah sama persis dengan plaintext-nya,
//    jadi `===` pasti selalu false (tidak berguna).
// 2. Kalaupun dibandingkan versi hash-nya sendiri, `===` biasa berhenti di
//    karakter pertama yang beda (short-circuit) - waktu prosesnya jadi
//    sedikit berbeda tergantung seberapa banyak karakter yang cocok di
//    awal. Ini celah kecil yang secara teori bisa dimanfaatkan penyerang
//    (timing attack) untuk menebak isi hash sedikit demi sedikit.
//    `bcrypt.compare` dirancang "timing-safe": waktu prosesnya selalu
//    konsisten berapa pun banyaknya karakter yang cocok, jadi tidak
//    membocorkan informasi lewat kecepatan respons.
//
// Guard yang sama seperti hashPassword() SENGAJA dipanggil juga di sini
// (bukan cuma di jalur hash) - ditemukan lewat independent review: bcrypt
// diam-diam memotong input di byte ke-72 pada KEDUA arah (hash maupun
// compare). Tanpa guard ini, password ">72 byte" yang 72 byte pertamanya
// kebetulan sama dengan password asli akan ikut dianggap "cocok" oleh
// bcrypt.compare - padahal hashPassword() TIDAK PERNAH menghasilkan hash
// dari password >72 byte (selalu ditolak duluan saat register). Menolak
// input >72 byte di sini juga tidak pernah salah menolak login yang sah,
// karena password asli yang berhasil di-hash pasti sudah <=72 byte.
async function verifyPassword(plainPassword, hash) {
  assertPasswordByteLengthWithinLimit(plainPassword);
  return bcrypt.compare(plainPassword, hash);
}

// SALT_ROUNDS ikut di-export (Phase 3C-4) supaya server.js bisa memverifikasi
// SAAT STARTUP bahwa cost factor DUMMY_HASH_FOR_TIMING_SAFETY (lihat komentar
// panjang soal itu di server.js) masih SAMA dengan angka ini - tanpa
// meng-import file ini, server.js terpaksa menulis ulang angka 12 sebagai
// literal terpisah, yang berarti DUA sumber kebenaran yang bisa diam-diam
// beda kalau salah satu diubah tanpa yang lain (persis masalah yang
// MAX_AGE_MS di lib/session.js juga hindari, lihat komentar di file itu).
module.exports = { hashPassword, verifyPassword, SALT_ROUNDS };
