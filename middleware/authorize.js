// middleware/authorize.js — Middleware `requireAdmin`: pintu gerbang KEDUA,
// setelah requireAuth, khusus route yang cuma boleh diakses admin (Phase 3C-3).
//
// Bedanya dengan middleware/auth.js: requireAuth menjawab pertanyaan "APAKAH
// user ini sudah login?" (autentikasi - siapa kamu). requireAdmin menjawab
// pertanyaan yang BEDA: "user yang SUDAH login ini, PUNYA IZIN atau tidak
// untuk melakukan aksi ini?" (otorisasi - kamu boleh apa). Dua hal ini
// SENGAJA dipisah jadi dua middleware/file berbeda (bukan digabung satu
// function besar) supaya masing-masing bertanggung jawab pada SATU
// pertanyaan saja, dan supaya route yang cuma butuh login (tanpa syarat
// role tertentu) bisa pakai requireAuth SENDIRIAN tanpa requireAdmin.
//
// Sengaja diekspor sebagai `requireAdmin` yang KONKRET (spesifik untuk role
// 'admin'), BUKAN sebagai factory generik semacam `requireRole('admin')`.
// Ini keputusan sadar mempersempit scope: saat ini di seluruh aplikasi CUMA
// ADA SATU kasus yang butuh role gating (route mutasi /api/products harus
// admin) - bikin factory generik sekarang berarti membangun abstraksi untuk
// kebutuhan yang belum benar-benar ada (YAGNI - You Aren't Gonna Need It).
// Kalau nanti muncul kasus KEDUA yang butuh role lain, factory `requireRole`
// bisa diperkenalkan saat itu, dituntun oleh kebutuhan nyata, bukan tebakan.

// requireAdmin HARUS dipasang SETELAH requireAuth di urutan middleware route,
// misal: app.post('/api/products', requireAuth, requireAdmin, handler).
// requireAdmin bergantung sepenuhnya pada req.user yang diisi oleh
// requireAuth - middleware ini sendiri TIDAK PERNAH membaca cookie atau
// query database, cuma membaca req.user yang seharusnya sudah disiapkan
// middleware sebelumnya.
function requireAdmin(req, res, next) {
  // Jaga-jaga (defensive check): SEHARUSNYA req.user selalu sudah ada di
  // titik ini kalau requireAuth benar-benar dipasang duluan di route yang
  // sama. Tapi middleware ini TIDAK BOLEH berasumsi urutan itu selalu benar
  // (misal suatu saat ada yang tidak sengaja lupa menaruh requireAuth saat
  // menambah route baru) - kalau req.user ternyata tidak ada, jangan sampai
  // baris di bawah (req.user.role) melempar TypeError "Cannot read
  // properties of undefined" yang membingungkan, tolak eksplisit dengan
  // pesan/status yang sama seperti requireAuth.
  if (!req.user) {
    return res.status(401).json({ status: 'error', message: 'Anda harus login untuk mengakses resource ini' });
  }

  if (req.user.role !== 'admin') {
    // 403 Forbidden, BUKAN 401 Unauthorized - beda kelas masalah: 401 berarti
    // "server tidak tahu siapa kamu" (belum/gagal login), sedangkan 403
    // berarti "server SUDAH TAHU siapa kamu (sudah login sah), tapi kamu
    // tetap tidak diizinkan melakukan aksi ini". User di titik ini SUDAH
    // lolos requireAuth (terbukti login sah), cuma role-nya bukan 'admin'.
    return res.status(403).json({ status: 'error', message: 'Anda tidak memiliki izin untuk mengakses resource ini' });
  }

  next();
}

module.exports = { requireAdmin };
