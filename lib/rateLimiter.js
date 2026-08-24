// lib/rateLimiter.js — Rate limiter fixed-window murni in-memory, TANPA
// dependency Express apa pun (Phase 3C-4: security hardening).
//
// Mengikuti pola file-file lib/ lain di project ini (password.js, session.js,
// user.js): logic "murni" (tidak tahu apa-apa soal req/res Express) dipisah
// ke sini, supaya bisa dites/dipakai lepas dari Express. Wiring Express-nya
// (baca req.ip, req.body.email, balas 429, dst) ada di middleware/rateLimit.js
// - file itu yang MEMAKAI checkLimit() di bawah, file ini sendiri tidak
// pernah menyentuh req/res.
//
// --- Algoritma: fixed window counter ---
// Setiap "key" (misal kombinasi IP+email untuk login) punya SATU bucket
// `{ count, resetAt }` di dalam Map. Selama masih di dalam window waktu yang
// sama (belum lewat `resetAt`), setiap percobaan menambah `count`. Begitu
// `count` mencapai `max`, percobaan berikutnya DITOLAK sampai window-nya
// habis - lalu bucket di-reset total (count kembali ke 1, resetAt bergeser
// ke depan lagi). Ini bukan algoritma rate-limit paling presisi (dibanding
// misalnya sliding window/token bucket - lonjakan request bisa terjadi pas
// window baru mulai), tapi cukup sederhana untuk ditulis tangan tanpa
// dependency, dan cukup efektif untuk menahan brute-force kasar semacam
// tebak-tebakan password berulang-ulang.
//
// --- Kenapa in-memory (Map), BUKAN disimpan di database/Redis ---
// Ini trade-off yang SENGAJA diambil untuk skala project ini (single-process,
// belajar/portfolio), BUKAN klaim "ini caranya bikin rate limiter yang benar
// untuk production multi-instance":
// - State-nya HILANG setiap kali proses Node di-restart (server mati/nyala
//   ulang, misal saat development atau deploy baru) - semua percobaan lama
//   dianggap "lupa", counter mulai dari nol lagi. Untuk app skala production
//   sungguhan yang butuh limit ketat menembus restart, ini kurang ideal.
// - State-nya TIDAK dibagi antar proses/instance. Kalau server ini suatu saat
//   dijalankan sebagai BEBERAPA instance sekaligus (misal di belakang load
//   balancer, atau pakai cluster mode Node), setiap instance punya Map-nya
//   SENDIRI-SENDIRI yang tidak saling tahu - penyerang secara teori bisa
//   "membagi" percobaannya ke instance berbeda untuk mengelabui limit total
//   yang dimaksud. Solusi yang benar untuk itu adalah shared store (Redis,
//   dkk), yang berarti dependency baru - di luar scope/constraint fase ini
//   ("no new npm dependency").
// Untuk app single-process skala belajar ini, trade-off di atas diterima:
// rate limiter ini tetap jauh lebih baik daripada tidak ada sama sekali
// (tetap menahan brute-force otomatis dari SATU sumber/proses), walau bukan
// pertahanan yang tidak bisa ditembus sama sekali oleh penyerang yang gigih.
//
// --- PENTING: rate limiter ini SATU LAPIS pertahanan, BUKAN satu-satunya ---
// (dicatat setelah review keamanan kedua, Phase 3C-4). Kunci (key) yang
// dipakai checkLimit() di sini SELALU berasal dari `req.ip` (lihat
// middleware/rateLimit.js) - dua keterbatasan bawaan dari itu, disengaja
// diterima untuk skala project ini, TAPI wajib dipahami sebelum project ini
// pernah di-deploy ke internet nyata:
//
// 1. ROTASI ALAMAT IPv6: penyerang yang punya alokasi IPv6 (lazim didapat
//    dari ISP mana pun, sering kali jutaan alamat sekaligus) bisa memakai
//    alamat BARU di setiap request. Karena key rate limiter berbasis
//    `req.ip`, setiap alamat baru berarti bucket yang selalu "kosong" -
//    secara efektif rate limiter ini TIDAK menahan penyerang seperti itu
//    sama sekali. Ini BUKAN bug yang bisa ditambal satu baris kode - ini
//    batas struktural dari "rate limit berbasis IP tanpa dependency/shared
//    store". Kalau project ini pernah butuh menahan penyerang sekelas ini,
//    solusinya bukan "perbaiki rate limiter ini", tapi lapisan tambahan yang
//    berbeda (misal CAPTCHA, device fingerprinting, atau shared store lintas
//    banyak sinyal) - semuanya di luar scope "security hardening minimal
//    tanpa dependency baru" yang disepakati untuk fase ini.
//
// 2. DEPLOYMENT DI BELAKANG REVERSE PROXY/LOAD BALANCER: saat ini `req.ip`
//    aman dipercaya APA ADANYA karena server ini jalan langsung tanpa proxy
//    di depannya (Express `trust proxy` masih default `false` - TIDAK
//    diaktifkan, dan MEMANG SENGAJA belum diaktifkan sekarang). Begitu
//    project ini suatu saat dijalankan di belakang reverse proxy/load
//    balancer sungguhan (Nginx, platform hosting, dll), `req.ip` TIDAK LAGI
//    otomatis benar tanpa konfigurasi tambahan - dua skenario gagal yang
//    mungkin terjadi kalau lupa/salah konfigurasi:
//    a) `trust proxy` TETAP tidak diaktifkan -> `req.ip` akan SELALU jadi
//       alamat proxy itu sendiri (sama untuk SEMUA pengguna asli) - rate
//       limiter jadi menyatukan SEMUA orang ke satu bucket per email, satu
//       pengguna nakal bisa mengunci pengguna lain yang tidak bersalah.
//    b) `trust proxy` diaktifkan SEMBARANGAN (percaya header
//       X-Forwarded-For begitu saja tanpa membatasi ke proxy tepercaya) ->
//       `req.ip` jadi BISA DIPALSUKAN client lewat header itu sendiri -
//       penyerang tinggal kirim X-Forwarded-For acak di setiap request untuk
//       selalu dapat bucket "baru", rate limiter jadi TIDAK BERGUNA SAMA
//       SEKALI.
//    Kesimpulan: KALAU/SAAT project ini di-deploy di belakang proxy, `trust
//    proxy` WAJIB dikonfigurasi dengan BENAR (biasanya: percaya HANYA proxy
//    tepercaya yang diketahui, bukan `true` begitu saja) - ini keputusan
//    yang harus diambil SAAT deployment nyata direncanakan, BUKAN sekarang
//    (project ini masih localhost-only, `trust proxy` SENGAJA tidak
//    diaktifkan/diubah di fase ini).

const buckets = new Map();

// checkLimit(key, { windowMs, max }): cek & catat SATU percobaan untuk `key`.
//
// - Kalau belum ada bucket untuk key ini, ATAU bucket-nya sudah lewat
//   window-nya (Date.now() >= resetAt): buat bucket BARU dengan count=1
//   (percobaan ini sendiri yang dihitung pertama) dan resetAt = sekarang +
//   windowMs. Selalu allowed:true - percobaan pertama di window baru tidak
//   pernah langsung ditolak.
// - Kalau bucket-nya ADA dan MASIH di dalam window:
//   - Kalau count SUDAH mencapai max: TOLAK (allowed:false), tanpa menambah
//     count lagi (supaya percobaan yang ditolak tidak ikut "memperpanjang"
//     kesan sudah dicoba berkali-kali - count berhenti persis di max).
//     retryAfterMs dihitung dari sisa waktu ke resetAt, supaya caller (lihat
//     middleware/rateLimit.js) bisa memberi tahu client kapan boleh coba lagi
//     (header Retry-After).
//   - Kalau belum mencapai max: tambah count, izinkan lanjut.
function checkLimit(key, { windowMs, max }) {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now >= bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true };
  }

  if (bucket.count >= max) {
    return { allowed: false, retryAfterMs: bucket.resetAt - now };
  }

  bucket.count += 1;
  return { allowed: true };
}

// --- Pembersihan berkala (cleanup) supaya Map tidak membesar tanpa batas ---
// Tanpa ini, setiap key BARU yang pernah muncul (misal kombinasi IP+email
// yang berbeda-beda dari waktu ke waktu) akan menumpuk SELAMANYA di Map,
// walaupun bucket-nya sendiri sudah lama kadaluarsa (resetAt sudah lewat
// jauh) dan tidak pernah dipakai lagi - lama-lama ini jadi memory leak pada
// proses server yang berjalan lama (long-running process). Setiap 10 menit,
// semua entry yang resetAt-nya sudah lewat (bucket-nya sudah tidak relevan
// lagi) dibuang dari Map.
//
// `.unref()` di baris setInterval bawah PENTING: secara default, sebuah
// setInterval yang masih aktif membuat proses Node TIDAK PERNAH dianggap
// "selesai" (event loop dianggap masih ada kerjaan), walaupun sebenarnya
// tidak ada lagi request yang diproses - ini bikin skrip test/proses
// berumur-pendek yang me-require file ini jadi TIDAK PERNAH keluar
// (exit) sendiri, harus dipaksa Ctrl+C. `.unref()` memberi tahu Node
// "interval ini boleh diabaikan saat memutuskan apakah proses sudah boleh
// keluar" - kalau semua pekerjaan lain sudah selesai, proses tetap bisa
// keluar normal walau interval ini masih terjadwal jalan lagi nanti. Ini
// TIDAK mengubah kapan intervalnya jalan (tetap tiap 10 menit selama
// prosesnya hidup), cuma mengubah apakah keberadaannya SENDIRI memaksa
// proses tetap hidup.
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;

const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (now >= bucket.resetAt) {
      buckets.delete(key);
    }
  }
}, CLEANUP_INTERVAL_MS);

cleanupTimer.unref();

module.exports = { checkLimit };
