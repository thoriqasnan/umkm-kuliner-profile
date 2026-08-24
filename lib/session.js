// lib/session.js — Signed-cookie session helpers, dibuat sendiri pakai modul
// bawaan Node `crypto` (Phase 3C-3: otorisasi).
//
// TIDAK pakai express-session/JWT/library session lain - sengaja tulis
// sendiri versi minimal, supaya jelas terlihat MEKANISME dasarnya: gimana
// caranya server bisa "percaya" isi cookie yang dikirim balik oleh browser,
// padahal cookie itu disimpan & bisa dibaca/diedit bebas oleh browser/user-nya
// sendiri (beda dengan data di database yang cuma bisa diubah lewat server).
//
// Mengikuti pola lib/password.js (Phase 3C-1): logic yang bakal dipakai lebih
// dari satu tempat (di sini: route login yang men-sign, dan middleware
// requireAuth yang men-verify) ditulis sekali di lib/, bukan di-copy-paste.

const crypto = require('crypto');

// --- Kenapa isi cookie tidak boleh CUMA berupa user id polos ---
// Kalau server menaruh cookie session cuma berisi id user apa adanya (misal
// cookie session=7 untuk user id 7), TIDAK ADA yang mencegah user tersebut
// - atau siapa pun yang bisa membuka DevTools browser - mengedit sendiri
// cookie itu jadi session=1, lalu server yang naif akan percaya begitu saja
// "oh ini user id 1" padahal yang sebenarnya login adalah user id 7. Cookie
// SEPENUHNYA berada di sisi client (browser), server tidak punya kendali
// apa pun atas isinya SETELAH dikirim - jadi kalau isinya cuma id polos,
// cookie itu 100% BISA DIPALSUKAN (forgeable) oleh siapa saja yang punya
// akses ke browser tersebut.
//
// Solusinya: cookie tidak cuma berisi id, tapi id + "bukti" (signature) bahwa
// id itu memang dihasilkan oleh SERVER (saat login berhasil), bukan dikarang
// sendiri oleh client. Bukti ini dibuat pakai HMAC (Hash-based Message
// Authentication Code): sejenis hash, tapi butuh SECRET KEY supaya bisa
// dihitung ulang - tanpa tahu secret key-nya, mustahil (secara komputasi)
// menghasilkan HMAC yang valid untuk suatu id.

// --- SESSION_SECRET WAJIB dari environment variable, TIDAK BOLEH hardcode ---
// Ini beda perlakuan dengan SALT_ROUNDS di lib/password.js (yang aman
// ditulis langsung di kode, lihat komentar di file itu) - alasannya:
// SALT_ROUNDS (=12) BUKAN sebuah rahasia, dia cuma "seberapa banyak kerja
// keras" bcrypt, siapa pun tahu angkanya pun tidak membantu memalsukan
// apa pun. SESSION_SECRET di sini SEBALIKNYA: dia betul-betul HARUS rahasia,
// karena siapa pun yang MEMEGANG nilai SESSION_SECRET ini bisa menghitung
// HMAC yang valid untuk id user MANAPUN sesuka hati (tinggal panggil
// `crypto.createHmac('sha256', SESSION_SECRET).update('id-user-manapun')`),
// lalu memalsukan cookie session yang keliatan sah untuk MENGAKU jadi user
// mana pun, termasuk admin. Kalau nilai ini ditulis langsung di kode
// (hardcode) dan kodenya ter-commit ke git (apalagi kalau repo publik),
// SIAPA SAJA yang baca kodenya otomatis punya kunci untuk memalsukan sesi
// siapa pun - itu sebabnya nilainya WAJIB datang dari luar kode (environment
// variable), tidak pernah ikut ter-commit ke git.
//
// Dicek & di-throw SEKALI saat file ini di-load (bukan tiap kali sign/verify
// dipanggil) - mengikuti filosofi "fail loud" yang sama seperti guard clause
// di lib/password.js: server yang jalan TANPA secret sama sekali lebih
// berbahaya daripada server yang menolak nyala. Kalau dibiarkan nyala tanpa
// secret (misal fallback ke string kosong/default), semua cookie yang
// ditandatangani hari ini jadi tidak berarti begitu secretnya beda di
// deploy berikutnya, atau lebih parah lagi kalau fallback-nya sama untuk
// SEMUA orang yang menjalankan project ini (jadi bukan rahasia sama sekali).
const SESSION_SECRET = process.env.SESSION_SECRET;

if (!SESSION_SECRET || SESSION_SECRET.trim().length === 0) {
  throw new Error(
    'SESSION_SECRET tidak ditemukan di environment variable. Server MENOLAK ' +
    'untuk nyala tanpa secret ini, karena secret ini dipakai untuk ' +
    'menandatangani (sign) cookie session - tanpa secret yang benar-benar ' +
    'rahasia, cookie session bisa dipalsukan siapa saja. Set dulu env var ' +
    'SESSION_SECRET sebelum menjalankan server, contoh: ' +
    'SESSION_SECRET=isi-string-acak-yang-panjang node server.js'
  );
}

// Nama cookie yang dipakai untuk menyimpan session - konstanta supaya kalau
// suatu saat mau ganti nama cookie-nya, cukup diubah di SATU tempat ini,
// tidak perlu cari-cari string 'session' tersebar di server.js/middleware.
const COOKIE_NAME = 'session';

// --- MAX_AGE_MS: umur maksimum sebuah session token, 24 jam ---
// Kenapa ini WAJIB satu konstanta yang di-export (bukan angka yang ditulis
// ulang di server.js untuk opsi cookie `maxAge`) - lihat penjelasan panjang
// di verify() di bawah soal kenapa expiry-nya harus ditanam DI DALAM payload
// yang ditandatangani. Intinya: `maxAge` cookie (di server.js) dan expiry
// yang dicek verify() di sini HARUS selalu sama nilainya, kalau ditulis dua
// kali sebagai literal terpisah, suatu saat salah satu diubah tapi yang lain
// lupa diubah akan bikin dua "durasi sesi" yang berbeda - satu sumber
// kebenaran (single source of truth) di sini mencegah itu.
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

// --- sign(userId): buat nilai cookie yang sudah "ditandatangani" ---
// Formatnya `${userId}.${issuedAt}.${hmacHex}` - id user & waktu sign (dalam
// milidetik sejak epoch) ditulis APA ADANYA (tidak dirahasiakan/dienkripsi,
// cuma tidak bisa DIPALSUKAN), diikuti HMAC dari GABUNGAN keduanya. HMAC-nya
// dihitung dari `${userId}.${issuedAt}` (bukan userId saja) supaya issuedAt
// ikut TERBUNGKUS oleh signature - kalau issuedAt tidak ikut ditandatangani,
// siapa pun yang punya cookie lama tinggal mengedit sendiri angka issuedAt-nya
// jadi "baru saja" tanpa merusak signature, dan expiry di verify() di bawah
// jadi percuma sama sekali.
function sign(userId) {
  const issuedAt = Date.now();
  const payload = `${userId}.${issuedAt}`;
  const hmacHex = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  return `${payload}.${hmacHex}`;
}

// --- verify(signedValue): cek keaslian & umur nilai cookie, balikin userId kalau valid ---
// Dipanggil di middleware requireAuth pada SETIAP request yang butuh login -
// artinya function ini menerima input MENTAH dari client (isi cookie),
// termasuk kemungkinan isi yang sengaja dirusak/dikarang orang iseng. Karena
// itu function ini SENGAJA TIDAK PERNAH throw untuk input yang jelek/aneh -
// cukup balikin `null` supaya middleware tinggal menganggapnya "tidak login",
// bukan bikin request itu berakhir 500 Internal Server Error (yang berarti
// "server kami yang salah", padahal ini murni cookie yang tidak valid, salah
// satu bentuk kesalahan/kejahilan sisi client).
//
// --- Kenapa expiry di sini yang SEBENARNYA menutup celah, bukan `maxAge` cookie ---
// Sebelum perubahan ini, satu-satunya "batas umur" session cuma opsi `maxAge`
// yang dipasang di res.cookie() (server.js) - itu HANYA instruksi ke BROWSER
// ("tolong buang cookie ini setelah sekian lama"), sekadar saran/kesepakatan
// yang tidak mengikat SERVER sama sekali. Kalau ada yang menyalin nilai cookie
// itu (lewat DevTools, traffic sniffing, dsb) dan mengirimkannya ulang lewat
// request buatan sendiri (curl/Postman, bukan lewat browser), server yang
// LAMA akan tetap menerimanya sebagai valid SELAMANYA - signature-nya toh
// tetap cocok secara matematis, tidak peduli sudah berapa lama. Ini juga
// sebabnya logout() lama cuma "kosmetik": clearCookie cuma menyuruh BROWSER
// menghapus cookie-nya, tapi kalau penyerang sudah keburu menyalin nilai
// cookie SEBELUM logout, salinan itu tetap bisa dipakai replay walau user
// aslinya sudah logout - dua reviewer independen membuktikan ini lewat test
// replay-attack nyata. Dengan issuedAt ikut ditandatangani DI DALAM payload
// (lihat sign() di atas) dan dicek di sini, SERVER sendiri yang menegakkan
// batas umur token - bukan cuma berharap browser baik hati membuang cookie-nya.
function verify(signedValue) {
  if (typeof signedValue !== 'string' || signedValue.length === 0) {
    return null;
  }

  // Format sekarang WAJIB persis 3 bagian dipisah titik: userId, issuedAt,
  // hmacHex. Beda dengan versi lama yang split di titik TERAKHIR (karena dulu
  // cuma ada 1 titik) - sekarang split di SEMUA titik, dan panjang hasilnya
  // harus PERSIS 3, tidak kurang tidak lebih. Kalau tidak PERSIS 3 bagian,
  // ini bukan format signedValue yang valid (baik format lama sebelum fix
  // ini, maupun format yang dirusak/dikarang).
  const parts = signedValue.split('.');
  if (parts.length !== 3) {
    return null;
  }

  const [userId, issuedAtStr, hmacHex] = parts;

  if (userId.length === 0 || issuedAtStr.length === 0 || hmacHex.length === 0) {
    return null;
  }

  // --- Validasi userId & issuedAt harus MURNI digit sebelum dipakai ---
  // Ini menutup DUA celah sekaligus: (1) issuedAtStr yang bukan angka murni
  // (misal string kosong/huruf/notasi ilmiah "1e9") akan bikin Number(...) di
  // bawah menghasilkan NaN, dan `Date.now() - NaN` selalu NaN, yang GAGAL di
  // setiap perbandingan `>` (NaN selalu false) - artinya token seperti itu
  // akan LOLOS cek expiry tanpa pernah dianggap kadaluarsa; (2) userId yang
  // bukan digit murni (misal disisipi karakter aneh) tidak boleh sampai ke
  // query database di middleware/auth.js (`WHERE id = ?`) sama sekali -
  // walaupun better-sqlite3 memakai parameterized query yang sudah aman dari
  // SQL injection, userId yang sudah dipastikan digit murni di sini tetap
  // pertahanan lapis awal yang lebih ketat/eksplisit terhadap input aneh.
  if (!/^\d+$/.test(userId) || !/^\d+$/.test(issuedAtStr)) {
    return null;
  }

  // Hitung ulang HMAC yang SEHARUSNYA ada untuk payload ini (userId +
  // issuedAt), pakai secret yang sama seperti saat sign(). Kalau signedValue
  // ini memang dihasilkan oleh sign() milik server sendiri (bukan dikarang
  // client), hasilnya akan PERSIS sama dengan hmacHex yang diklaim di cookie.
  const payload = `${userId}.${issuedAtStr}`;
  const expectedHmacHex = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');

  // --- Kenapa dibandingkan pakai crypto.timingSafeEqual, BUKAN `===` ---
  // Sama persis alasannya seperti kenapa lib/password.js pakai
  // bcrypt.compare bukan `===` untuk cocokkan password: perbandingan string
  // biasa (`===`/`Buffer.equals`) berhenti di karakter PERTAMA yang beda
  // (short-circuit) - membandingkan "aaaa" dengan "abcd" lebih CEPAT selesai
  // daripada membandingkan "aaaa" dengan "aaab" (beda di karakter terakhir).
  // Selisih waktu itu KECIL SEKALI untuk satu kali cek, tapi kalau penyerang
  // bisa mengirim jutaan percobaan (bruteforce hmacHex tebak-tebakan satu
  // karakter demi satu karakter sambil mengukur response time server), lama-
  // lama selisih waktu itu bisa dipakai untuk menyusun ulang hmacHex yang
  // valid TANPA pernah tahu SESSION_SECRET-nya sama sekali - ini disebut
  // timing attack. `crypto.timingSafeEqual` dirancang supaya waktu
  // pembandingannya SELALU konstan (selalu mengecek semua byte sampai
  // habis, tidak peduli di mana letak byte yang beda), jadi tidak
  // membocorkan informasi apa pun lewat kecepatan respons.
  //
  // `crypto.timingSafeEqual` MEWAJIBKAN dua Buffer yang PANJANGNYA SAMA -
  // dia throw error kalau panjangnya beda (bukan mengembalikan false).
  // Itu sebabnya panjang dicek MANUAL dulu di bawah sebelum memanggilnya -
  // hmacHex hasil sha256 SELALU 64 karakter hex (32 byte), jadi hmacHex dari
  // client yang panjangnya beda dari expectedHmacHex sudah pasti tidak akan
  // pernah valid, dan kita balikin null langsung tanpa perlu (dan tanpa
  // bisa) memanggil timingSafeEqual untuk kasus itu.
  const providedBuffer = Buffer.from(hmacHex, 'hex');
  const expectedBuffer = Buffer.from(expectedHmacHex, 'hex');

  if (providedBuffer.length !== expectedBuffer.length) {
    return null;
  }

  if (!crypto.timingSafeEqual(providedBuffer, expectedBuffer)) {
    return null;
  }

  // --- Cek expiry SETELAH signature terbukti valid ---
  // Sengaja dicek belakangan (bukan duluan sebelum timingSafeEqual) - urutan
  // ini penting: kalau signature-nya saja sudah tidak valid (dipalsukan),
  // tidak ada gunanya (dan tidak masuk akal) mengecek "kadaluarsa atau belum"
  // dari issuedAt yang mungkin juga dikarang. Expiry HANYA relevan untuk
  // token yang SUDAH terbukti asli dari server ini.
  const ageMs = Date.now() - Number(issuedAtStr);
  if (ageMs > MAX_AGE_MS) {
    // Token asli (signature valid), tapi sudah lewat umur maksimumnya -
    // diperlakukan SAMA seperti signature tidak valid: balikin null, supaya
    // requireAuth menganggapnya "tidak login" (401), bukan kasus khusus yang
    // beda pesannya (konsisten dengan prinsip tidak membocorkan detail alasan
    // penolakan ke client).
    return null;
  }

  return userId;
}

module.exports = { sign, verify, COOKIE_NAME, MAX_AGE_MS };
