// lib/user.js — Logic yang dipakai IDENTIK oleh register & login, dipisah dari
// route (Phase 3C-2).
//
// Mengikuti pola yang sama dengan lib/password.js dari Phase 3C-1: reusable
// logic yang dibutuhkan lebih dari satu endpoint sebaiknya ditulis SEKALI di
// lib/, bukan di-copy-paste di tiap route. Dua fungsi di bawah ini dipakai
// PERSIS SAMA oleh POST /api/auth/register (cek email sudah terdaftar atau
// belum) DAN POST /api/auth/login (cari user untuk verifikasi password) - kalau
// ditulis ulang di masing-masing route, ada risiko suatu saat cuma salah satu
// tempat yang diupdate kalau ada perbaikan (misal aturan normalisasi email
// berubah).

// Normalisasi email SEBELUM disimpan atau dicari di database.
// - trim(): buang spasi tidak sengaja di awal/akhir (misal user copy-paste
//   dari tempat lain dan kebawa spasi).
// - toLowerCase(): email secara konvensi TIDAK case-sensitive
//   ("User@Mail.com" dan "user@mail.com" harus dianggap akun yang SAMA).
// Tanpa normalisasi ini, constraint UNIQUE di kolom email (lihat
// db/database.js) tidak akan mencegah duplikat "User@Mail.com" vs
// "user@mail.com" - dua-duanya akan lolos sebagai baris berbeda padahal
// seharusnya email yang sama.
function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

// Cari SATU user berdasarkan email (yang SUDAH dinormalisasi oleh pemanggil).
// Dipakai di register (cek "email ini sudah terdaftar belum?") dan login
// (cari akun yang mau di-cek passwordnya) - query SQL-nya identik di kedua
// tempat, jadi diekstrak ke sini daripada ditulis dua kali.
//
// `db` sengaja diterima sebagai parameter (bukan di-require sendiri di sini
// dari './db/database'), supaya file ini tidak terikat langsung ke satu
// koneksi database tertentu - lebih gampang dipakai ulang/di-test.
function findUserByEmail(db, email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email);
}

module.exports = { normalizeEmail, findUserByEmail };
