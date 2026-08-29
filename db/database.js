// db/database.js — Koneksi SQLite + pembuatan table + seeding data awal.
//
// File ini TIDAK berisi route Express. Tugasnya cuma 3:
// 1. Buka (atau buat baru kalau belum ada) file database SQLite di data/umkm.db
// 2. Pastikan table `products` ada (CREATE TABLE IF NOT EXISTS -> aman
//    dijalankan berkali-kali, tidak akan error atau menghapus data kalau
//    table-nya sudah ada dari sebelumnya)
// 3. Isi (seed) 11 produk PERSIS seperti hardcoded array lama di server.js,
//    tapi HANYA kalau table-nya masih kosong (supaya restart server berkali-
//    kali tidak menduplikasi data - lihat fungsi seedIfEmpty() di bawah)
//
// server.js tinggal `require('./db/database')` dan dapat `db` (koneksi siap
// pakai) untuk menjalankan query SELECT di route /api/products.

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

// __dirname di sini = folder db/, jadi '..' naik satu tingkat ke root project,
// lalu masuk ke folder data/. Kalau folder data/ belum ada, better-sqlite3
// TIDAK otomatis membuat foldernya (cuma file-nya) - makanya folder data/
// harus kita buat sendiri lebih dulu di bawah.
const DB_PATH = path.join(__dirname, '..', 'data', 'umkm.db');

// Pastikan folder data/ ada sebelum file .db dibuka/dibuat. Penting untuk
// fresh clone: folder data/ di-gitignore (tidak ter-track git), jadi di clone
// baru folder ini belum ada sama sekali. `recursive: true` membuat aman
// dipanggil berkali-kali (tidak error kalau foldernya sudah ada).
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

// `new Database(path)` = buka koneksi ke file SQLite di path itu.
// Kalau file belum ada sama sekali, better-sqlite3 otomatis MEMBUATNYA
// (file .db kosong tanpa table apa pun) - baru setelah itu kita buat
// table-nya sendiri lewat CREATE TABLE di bawah.
const db = new Database(DB_PATH);

// Foreign-key enforcement di SQLite bersifat per-connection dan default-nya
// nonaktif. Cart bergantung pada FK untuk mencegah row orphan dan menjalankan
// ON DELETE CASCADE, jadi aktifkan lalu verifikasi secara fail-loud sebelum
// schema apa pun yang memakai foreign key dibuat/digunakan.
db.pragma('foreign_keys = ON');
const foreignKeysEnabled = db.pragma('foreign_keys', { simple: true });

if (foreignKeysEnabled !== 1) {
  throw new Error('SQLite foreign-key enforcement gagal diaktifkan. Server menolak startup.');
}

// --- 1. Buat table `products` kalau belum ada ---
// IF NOT EXISTS = idempotent, artinya baris kode ini AMAN dijalankan setiap
// kali server start (misal server di-restart berkali-kali saat development)
// tanpa menghapus atau menimpa table yang sudah ada.
//
// Kolom image di-flatten (dipecah jadi image_src, image_srcset, dst) karena
// SQLite tidak punya tipe data "object bersarang" seperti di JavaScript -
// setiap kolom cuma boleh berisi satu nilai sederhana (angka/teks/null).
// Nanti saat query SELECT di server.js, kolom-kolom ini disusun ULANG jadi
// object `image: { src, srcset, sizes, alt, width, height }` supaya response
// JSON ke frontend tetap PERSIS sama strukturnya seperti sebelumnya.
db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    price INTEGER NOT NULL,
    category TEXT NOT NULL,
    image_src TEXT NOT NULL,
    image_srcset TEXT,
    image_sizes TEXT,
    image_alt TEXT NOT NULL,
    image_width INTEGER NOT NULL,
    image_height INTEGER NOT NULL
  );
`);

// --- 1b. Buat table `users` kalau belum ada (Phase 3C-1: fondasi auth) ---
// Kolomnya sengaja `password_hash`, BUKAN `password` - penamaan ini jadi
// pengingat permanen di schema bahwa yang disimpan SELAMANYA cuma hasil hash
// (lewat bcrypt, lihat lib/password.js), TIDAK PERNAH plaintext. Kalau nama
// kolomnya cuma `password`, gampang lupa/salah nanti pas nulis query INSERT
// dan tanpa sadar nyimpen plaintext langsung.
//
// `email TEXT NOT NULL UNIQUE` - UNIQUE di level database (bukan cuma dicek
// manual di kode) supaya tidak mungkin ada dua akun dengan email sama,
// bahkan kalau suatu saat ada race condition (dua request register barengan
// dengan email sama) atau ada bug di validasi sisi aplikasi. Database jadi
// garis pertahanan terakhir yang tidak bisa "kelewatan".
//
// Endpoint untuk insert ke table ini (register/login) BELUM dibuat di fase
// ini - table-nya disiapkan dulu di 3C-1, endpoint-nya menyusul di 3C-2.
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

// --- 1c. Buat table `cart_items` untuk cart authenticated user (Phase 3D-7B) ---
// Satu user hanya boleh punya satu row per produk. Nama/harga/total tidak
// disimpan di sini: metadata tersebut tetap authoritative dari table products.
db.exec(`
  CREATE TABLE IF NOT EXISTS cart_items (
    user_id INTEGER NOT NULL CHECK (
      typeof(user_id) = 'integer' AND user_id > 0
    ),
    product_id INTEGER NOT NULL CHECK (
      typeof(product_id) = 'integer' AND product_id > 0
    ),
    quantity INTEGER NOT NULL CHECK (
      typeof(quantity) = 'integer'
      AND quantity BETWEEN 1 AND 99
    ),
    note TEXT NOT NULL DEFAULT '' CHECK (
      typeof(note) = 'text'
      AND length(note) <= 200
    ),
    PRIMARY KEY (user_id, product_id),
    FOREIGN KEY (user_id)
      REFERENCES users(id)
      ON DELETE CASCADE,
    FOREIGN KEY (product_id)
      REFERENCES products(id)
      ON DELETE CASCADE
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS cart_merges (
    user_id INTEGER NOT NULL,
    merge_id TEXT NOT NULL,
    skipped_product_ids TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, merge_id),
    FOREIGN KEY (user_id)
      REFERENCES users(id)
      ON DELETE CASCADE
  );
`);

// cart_merges sempat diperkenalkan di worktree Phase 3D-7C sebelum metadata
// hasil skip disimpan. Pertahankan database development tersebut tanpa reset:
// tambah kolom secara idempotent bila table versi awal sudah terlanjur dibuat.
const cartMergeColumns = db.prepare('PRAGMA table_info(cart_merges)').all();
if (!cartMergeColumns.some((column) => column.name === 'skipped_product_ids')) {
  db.exec("ALTER TABLE cart_merges ADD COLUMN skipped_product_ids TEXT NOT NULL DEFAULT '[]'");
}

// --- 1c. Migrasi: tambah kolom `role` ke table users (Phase 3C-3: otorisasi) ---
// Beda dengan CREATE TABLE IF NOT EXISTS di atas: table `users` sendiri
// SUDAH ADA sejak Phase 3C-1 (di database orang yang sudah pernah menjalankan
// server ini sebelum Phase 3C-3), jadi tidak bisa cukup "CREATE TABLE IF NOT
// EXISTS" lagi - table-nya sudah ada, cuma KOLOMnya yang belum. SQLite juga
// tidak punya sintaks "ALTER TABLE ... ADD COLUMN IF NOT EXISTS" bawaan,
// jadi pengecekannya harus dilakukan manual di kode: baca dulu daftar kolom
// yang ADA SEKARANG lewat `PRAGMA table_info(users)`, baru tambahkan kolom
// `role` kalau memang belum ada.
//
// Idempotent (aman dijalankan berkali-kali setiap server start) itu penting
// di sini: kalau langsung jalankan ALTER TABLE ADD COLUMN tanpa cek dulu,
// run kedua dan seterusnya akan error "duplicate column name" karena
// kolomnya sudah ada dari run pertama.
//
// `role TEXT NOT NULL DEFAULT 'user'` - DEFAULT 'user' otomatis mengisi
// kolom ini untuk SEMUA baris users yang sudah ada sebelum migrasi ini
// (akun-akun lama yang dibuat sebelum Phase 3C-3 tidak akan punya role
// NULL/kosong), dan juga jadi nilai default untuk INSERT baru yang tidak
// menyebutkan kolom role sama sekali (lihat INSERT di POST /api/auth/register
// di server.js - sengaja TIDAK mengisi role, supaya user baru SELALU jadi
// 'user' biasa secara default, tidak bisa diakali jadi 'admin' lewat body
// request register/mass-assignment).
const usersColumns = db.prepare('PRAGMA table_info(users)').all();
const hasRoleColumn = usersColumns.some((col) => col.name === 'role');

if (!hasRoleColumn) {
  // --- CHECK (role IN ('user', 'admin')) - hanya berlaku untuk fresh install ---
  // Ditambahkan sebagai defense-in-depth (bukan perbaikan atas celah yang
  // sedang aktif dieksploitasi): saat ini TIDAK ADA satu pun jalur kode yang
  // menulis nilai role selain 'user'/'admin' (lihat POST /api/auth/register
  // di server.js - sengaja tidak pernah mengisi role dari body request), jadi
  // constraint ini cuma jaring pengaman untuk bug hipotetis di masa depan.
  //
  // CATATAN PENTING soal SQLite: constraint CHECK ini HANYA berlaku untuk
  // database yang benar-benar baru (belum pernah punya kolom role sama
  // sekali - masuk ke branch `if` ini). Untuk database yang SUDAH ADA dari
  // sebelum Phase 3C-3 (kolom role-nya sudah pernah ditambahkan lewat ALTER
  // TABLE ADD COLUMN tanpa CHECK, di deploy/clone sebelumnya), SQLite TIDAK
  // BISA menambahkan CHECK constraint ke kolom yang sudah ada lewat ALTER
  // TABLE - satu-satunya cara adalah rebuild penuh table (buat table baru
  // dengan schema+CHECK yang diinginkan, salin semua data lama, drop table
  // lama, rename table baru). Migrasi rebuild seperti itu di luar scope
  // perbaikan MINOR ini (risikonya rendah, lihat paragraf di atas) - jadi
  // database lama yang sudah punya kolom role tanpa CHECK akan TETAP tanpa
  // CHECK selamanya kecuali di-migrasi manual terpisah nanti.
  db.exec(`ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin'))`);
  console.log('[db] Kolom role ditambahkan ke table users (migrasi Phase 3C-3).');
} else {
  console.log('[db] Kolom role sudah ada di table users, migrasi dilewati.');
}

// --- 1c-2. Migrasi: tambah kolom `token_version` ke table users (perbaikan revocation logout) ---
// Sama persis polanya dengan migrasi kolom `role` tepat di atas (table users
// SUDAH ADA dari fase-fase sebelumnya, jadi tidak cukup CREATE TABLE IF NOT
// EXISTS - harus dicek dulu lewat PRAGMA table_info(users), baru ALTER TABLE
// ADD COLUMN kalau memang belum ada), dikelompokkan di sini karena sama-sama
// migrasi table `users`.
//
// --- KENAPA kolom ini perlu ada sama sekali: celah "logout palsu" ---
// Final Regression menemukan (dan dua reviewer independen membuktikan lewat
// test replay-attack nyata, lihat komentar panjang di lib/session.js verify())
// bahwa session cookie project ini adalah token HMAC-signed yang SEPENUHNYA
// stateless - sebelum perbaikan ini, POST /api/auth/logout cuma memanggil
// res.clearCookie(), yaitu instruksi SATU ARAH ke BROWSER ("tolong buang
// cookie ini"), sama sekali TIDAK mengubah apa pun di sisi SERVER. Kalau ada
// yang sempat MENYALIN nilai cookie SEBELUM user logout (lewat DevTools,
// traffic sniffing, dsb), salinan itu tetap valid dan bisa di-replay lewat
// request buatan sendiri (curl/Postman) SETELAH user itu logout - server lama
// tidak punya cara sama sekali untuk membedakan "token ini masih sah" dari
// "token ini sudah di-logout-kan pemiliknya sendiri". Logout jadi cuma
// kosmetik di sisi client, tidak benar-benar merevoke apa pun.
//
// --- KENAPA desainnya DB-backed counter, BUKAN in-memory blacklist ---
// Alternatif yang lebih "jelas" kelihatannya adalah menyimpan daftar token
// yang sudah di-revoke di memori (misal Set/Map di process Node) - tapi itu
// PUNYA CACAT FATAL: begitu server di-restart (deploy baru, crash, dsb),
// seluruh state di memori HILANG, dan semua token yang tadinya sudah
// di-revoke otomatis jadi valid lagi seolah tidak pernah logout. Pendekatan
// counter di kolom database ini SELAMAT dari restart (data tersimpan
// permanen di file umkm.db), dan yang lebih penting: ini PERSIS meniru pola
// yang SUDAH ADA di requireAuth (middleware/auth.js) untuk kolom `role` -
// query users FRESH dari database di SETIAP request yang butuh login, bukan
// cukup percaya isi cookie. Kolom token_version ini cuma menambah SATU kolom
// lagi ke query SELECT yang sudah ada itu - tidak perlu subsistem baru,
// tidak perlu interval cleanup baru, tidak perlu dependency npm baru.
//
// --- Cara kerjanya (detail penuh di lib/session.js & middleware/auth.js) ---
// sign() sekarang menanam tokenVersion SAAT ITU ke dalam payload yang
// ditandatangani. Saat logout (server.js), token_version user itu di-UPDATE
// jadi +1. Token LAMA yang masih membawa tokenVersion sebelum increment jadi
// otomatis "basi" - requireAuth membandingkan tokenVersion di dalam cookie
// dengan token_version TERKINI di database, dan menolak (401) kalau tidak
// cocok, PERSIS seperti cara requireAuth sudah menolak/menerima berdasarkan
// role terkini.
//
// --- Trade-off yang SENGAJA diterima: logout merevoke SEMUA sesi user itu ---
// Karena token_version adalah SATU angka per user (bukan per-device/per-sesi),
// logout dari satu tempat otomatis merevoke SEMUA token yang pernah di-sign
// untuk user itu, di mana pun token itu berada - bukan cuma sesi yang memanggil
// logout itu sendiri. Ini trade-off yang diterima dengan sadar: project ini
// SAMA SEKALI belum punya konsep "multi-device session" (tidak ada tabel
// sessions terpisah per device, tidak ada UI "sesi aktif di perangkat lain"),
// dan secara realistis dipakai single-admin/single-device - kalaupun ada
// beberapa device aktif bersamaan, semuanya harus login ulang setelah salah
// satu logout, konsekuensi yang jauh lebih aman daripada TIDAK merevoke sama
// sekali (kondisi sebelum perbaikan ini).
//
// `INTEGER NOT NULL DEFAULT 0` - semua user lama (dibuat sebelum migrasi ini)
// otomatis mulai dari 0, konsisten dengan token lama yang mereka pegang (kalau
// ada) yang di-sign SEBELUM konsep tokenVersion ada sama sekali - lihat catatan
// "deployment consequence" di lib/session.js soal kenapa token lama itu tetap
// akan ditolak walau nilainya 0 di database (format cookie-nya sendiri sudah
// berubah dari 3 bagian jadi 4 bagian).
const usersColumnsForTokenVersion = db.prepare('PRAGMA table_info(users)').all();
const hasTokenVersionColumn = usersColumnsForTokenVersion.some((col) => col.name === 'token_version');

if (!hasTokenVersionColumn) {
  db.exec(`ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0`);
  console.log('[db] Kolom token_version ditambahkan ke table users (revocation logout).');
} else {
  console.log('[db] Kolom token_version sudah ada di table users, migrasi dilewati.');
}

// --- 1d. Migrasi: tambah kolom description_id & description_en ke table products (Phase 3C-5: deskripsi bilingual) ---
// Sama seperti migrasi kolom `role` di table `users` di atas: table `products`
// SUDAH ADA sejak Phase 3A (di database orang yang sudah pernah menjalankan
// server ini sebelum Phase 3C-5), jadi tidak bisa cukup "CREATE TABLE IF NOT
// EXISTS" lagi - table-nya sudah ada, cuma KOLOM-nya yang belum. Pola
// pengecekannya PERSIS sama: baca dulu daftar kolom yang ADA SEKARANG lewat
// `PRAGMA table_info(products)`, baru tambahkan kolom yang belum ada -
// idempotent, aman dijalankan berkali-kali setiap server start.
//
// Kenapa DUA kolom terpisah (description_id & description_en), BUKAN satu
// kolom `description` saja: situs ini bilingual (Bahasa Indonesia & Inggris -
// lihat kamus i18n statis di script.js). Satu kolom saja berarti tiap produk
// cuma bisa punya SATU bahasa deskripsi tersimpan, dan separuh pengunjung
// situs (yang bahasanya beda) akan melihat deskripsi dalam bahasa yang salah
// atau kosong. Dua kolom terpisah memastikan kedua bahasa tersimpan
// independen, konsisten dengan cara kamus i18n di frontend sudah memisahkan
// id/en per key.
//
// `NOT NULL DEFAULT ''` (string kosong, BUKAN NULL): artinya SEMUA 11 produk
// seed yang sudah ada otomatis dapat description_id='' dan description_en=''
// begitu migrasi ADD COLUMN ini jalan. Migrasi ADD COLUMN ini SENDIRI
// sengaja tidak langsung mengisi nilainya - nambah kolom dan mengisi data
// adalah dua kekhawatiran yang beda, jadi dipisah jadi migrasi tersendiri
// (lihat blok 1e tepat di bawah) yang memindahkan deskripsi 11 produk itu
// dari kamus i18n statis di script.js ke kolom-kolom ini. Sebelum blok 1e
// itu jalan (atau untuk produk baru yang sengaja dibiarkan kosong), kolom
// kosong ini tetap aman - frontend fallback ke kamus i18n lewat
// getProductDescriptionText() di script.js kalau kolom database kosong.
const productsColumns = db.prepare('PRAGMA table_info(products)').all();
const hasDescriptionIdColumn = productsColumns.some((col) => col.name === 'description_id');
const hasDescriptionEnColumn = productsColumns.some((col) => col.name === 'description_en');

if (!hasDescriptionIdColumn) {
  db.exec(`ALTER TABLE products ADD COLUMN description_id TEXT NOT NULL DEFAULT ''`);
  console.log('[db] Kolom description_id ditambahkan ke table products (migrasi Phase 3C-5).');
} else {
  console.log('[db] Kolom description_id sudah ada di table products, migrasi dilewati.');
}

if (!hasDescriptionEnColumn) {
  db.exec(`ALTER TABLE products ADD COLUMN description_en TEXT NOT NULL DEFAULT ''`);
  console.log('[db] Kolom description_en ditambahkan ke table products (migrasi Phase 3C-5).');
} else {
  console.log('[db] Kolom description_en sudah ada di table products, migrasi dilewati.');
}

// --- 1e. Migrasi: backfill description_id & description_en 11 produk seed lama ---
// Beda dengan migrasi 1d di atas (yang cuma nambah KOLOM-nya), blok ini
// mengisi NILAI kolom itu untuk 11 produk seed yang sudah ada dari sebelum
// Phase 3C-5 - deskripsi mereka SELALU ada (sudah dari dulu tampil di kartu
// menu live), cuma sumbernya masih di kamus i18n statis di script.js
// (`translations.id`/`translations.en`, key `product.<slug>.desc`), BELUM
// pernah disalin ke database. Tanpa backfill ini, admin yang buka form
// "Edit Produk" untuk salah satu dari 11 produk lama akan melihat textarea
// deskripsi KOSONG walau produknya sebenarnya sudah punya deskripsi yang
// tampil ke pengunjung situs - membingungkan dan berisiko admin menyimpan
// ulang dengan deskripsi kosong (menghapus fallback ke i18n tanpa sadar,
// lihat getProductDescriptionText() di script.js).
//
// SENGAJA TIDAK digabung ke dalam gate `if (row.count === 0)` seeding di
// bawah (poin 3) - itu gate untuk INSERT baris baru ke table yang KOSONG
// (fresh install), sedangkan blok ini untuk meng-UPDATE baris yang SUDAH
// ADA di database orang yang sudah pernah menjalankan server ini sebelum
// Phase 3C-5. Makanya blok ini jalan TANPA syarat, di setiap server start -
// tapi tetap aman berkat guard WHERE di bawah, jadi tidak perlu (dan tidak
// boleh) digantungkan ke pengecekan row.count.
//
// GUARD PALING PENTING: `WHERE slug = @slug AND description_id = ''
// AND description_en = ''` - harus AND, BUKAN OR. Ini backfill HANYA
// boleh menyentuh baris yang BENAR-BENAR belum pernah disentuh sama sekali
// (kedua bahasa masih kosong) sejak kolomnya ada. Kalau admin sudah pernah
// mengedit SALAH SATU bahasa saja lewat form "Edit Produk" yang baru
// (misal sengaja menulis description_en custom untuk "tahuisi" tapi
// membiarkan description_id kosong dengan sengaja), baris itu TIDAK BOLEH
// disentuh sama sekali oleh backfill ini - edit manual admin (walau cuma
// separuh) harus menang atas auto-backfill, tidak boleh ditimpa diam-diam.
// Kalau guard-nya pakai OR, kasus di atas akan salah isi description_id
// dengan teks lama padahal admin sengaja mengosongkannya.
//
// Guard ini juga yang membuat blok ini aman dijalankan berkali-kali setiap
// server start (idempotent): run pertama pada database lama akan meng-
// update 11 baris (semuanya masih kosong dari migrasi 1d), run-run
// berikutnya jadi no-op (0 baris ter-update) karena kolomnya sudah terisi -
// baik oleh backfill ini sendiri maupun oleh edit admin sungguhan.
const legacyDescriptions = [
  { slug: 'nasigoreng', description_id: 'Nasi goreng dengan telur, ayam suwir, dan acar segar.', description_en: 'Fried rice with egg, shredded chicken, and fresh pickles.' },
  { slug: 'ayamgeprek', description_id: 'Ayam crispy disiram sambal matah khas dengan tingkat kepedasan pilihan.', description_en: 'Crispy chicken topped with signature sambal matah, spice level of your choice.' },
  { slug: 'sotoayam', description_id: 'Kuah bening gurih dengan suwiran ayam kampung dan pelengkap lengkap.', description_en: 'Clear savory broth with shredded free-range chicken and full garnish.' },
  { slug: 'mieayam', description_id: 'Mie ayam dengan topping bakso sapi dan pangsit renyah.', description_en: 'Chicken noodles topped with beef meatballs and crispy dumplings.' },
  { slug: 'esteh', description_id: 'Teh manis segar dengan es batu, pas untuk menemani makan siang.', description_en: 'Refreshing sweet tea with ice, perfect alongside lunch.' },
  { slug: 'esjeruk', description_id: 'Jeruk peras asli tanpa pemanis buatan, menyegarkan.', description_en: 'Genuine squeezed orange juice with no artificial sweeteners, refreshing.' },
  { slug: 'kopisusu', description_id: 'Kopi susu dengan manis alami dari gula aren pilihan.', description_en: 'Milk coffee naturally sweetened with quality palm sugar.' },
  { slug: 'eskelapa', description_id: 'Kelapa muda asli dengan sedikit sirup gula merah.', description_en: 'Fresh young coconut with a touch of palm sugar syrup.' },
  { slug: 'pisanggoreng', description_id: 'Pisang goreng renyah di luar, lembut di dalam. Isi 5 pcs.', description_en: 'Crispy on the outside, soft on the inside. 5 pieces per order.' },
  { slug: 'risoles', description_id: 'Risoles isi sayuran dan mayo, cocok untuk camilan sore.', description_en: 'Risoles filled with vegetables and mayo, perfect for an afternoon snack.' },
  { slug: 'tahuisi', description_id: 'Tahu isi sayuran, digoreng renyah, disajikan dengan cabai rawit.', description_en: "Vegetable-stuffed tofu, fried crispy, served with bird's eye chilies." },
];

// `db.transaction(...)` di sini sama alasannya dengan insertAll di poin 3
// di bawah: 11 UPDATE ini dibungkus jadi satu transaksi supaya konsisten
// (semua ter-update bersama atau tidak sama sekali) dan lebih cepat
// daripada 11 query terpisah di luar transaksi.
const backfillDescription = db.prepare(`
  UPDATE products
  SET description_id = @description_id, description_en = @description_en
  WHERE slug = @slug AND description_id = '' AND description_en = ''
`);

const backfillAll = db.transaction((rows) => {
  let updated = 0;
  for (const row of rows) {
    const result = backfillDescription.run(row);
    updated += result.changes;
  }
  return updated;
});

const backfilledCount = backfillAll(legacyDescriptions);
console.log(`[db] Backfill deskripsi produk lama: ${backfilledCount} dari ${legacyDescriptions.length} baris ter-update (sisanya sudah terisi - backfill sebelumnya atau edit admin).`);

// --- 2. Data seed: PERSIS 11 produk yang dulu hardcoded di server.js ---
// Disalin apa adanya (id, slug, name, price, category, image.*) - TIDAK ada
// data baru yang dikarang, supaya konsisten 100% dengan Phase 2B.
//
// Field `description` (Phase 3C-5 lanjutan) ditambahkan belakangan supaya
// FRESH install (database baru, belum pernah ada sama sekali) langsung seed
// dengan deskripsi yang benar sejak hari pertama - bukan kolom kosong yang
// baru terisi lewat migrasi backfill terpisah di bawah. Teksnya disalin
// APA ADANYA dari kamus i18n statis di script.js (`translations.id`/
// `translations.en`, key `product.<slug>.desc`) - itu satu-satunya sumber
// kebenaran untuk teks ini, jadi TIDAK ditulis ulang/dikarang di sini.
const seedProducts = [
  { id: 1, slug: 'nasigoreng', name: 'Nasi Goreng Spesial', price: 20000, category: 'makanan',
    image: { src: 'images/nasi-goreng-spesial.jpg', srcset: null, sizes: null, alt: 'Nasi Goreng Spesial', width: 700, height: 467 },
    description: { id: 'Nasi goreng dengan telur, ayam suwir, dan acar segar.', en: 'Fried rice with egg, shredded chicken, and fresh pickles.' } },
  { id: 2, slug: 'ayamgeprek', name: 'Ayam Geprek Sambal Matah', price: 22000, category: 'makanan',
    image: { src: 'images/ayam-geprek-sambal-matah.jpg', srcset: null, sizes: null, alt: 'Ayam Geprek Sambal Matah', width: 700, height: 467 },
    description: { id: 'Ayam crispy disiram sambal matah khas dengan tingkat kepedasan pilihan.', en: 'Crispy chicken topped with signature sambal matah, spice level of your choice.' } },
  { id: 3, slug: 'sotoayam', name: 'Soto Ayam Kampung', price: 20000, category: 'makanan',
    image: { src: 'images/soto-ayam-kampung.jpg', srcset: 'images/soto-ayam-kampung-480w.jpg 480w, images/soto-ayam-kampung.jpg 700w', sizes: '(max-width: 768px) 100vw, (max-width: 900px) 50vw, 360px', alt: 'Soto Ayam Kampung', width: 700, height: 467 },
    description: { id: 'Kuah bening gurih dengan suwiran ayam kampung dan pelengkap lengkap.', en: 'Clear savory broth with shredded free-range chicken and full garnish.' } },
  { id: 4, slug: 'mieayam', name: 'Mie Ayam Bakso', price: 18000, category: 'makanan',
    image: { src: 'images/mie-ayam-bakso.jpg', srcset: 'images/mie-ayam-bakso-480w.jpg 480w, images/mie-ayam-bakso.jpg 559w', sizes: '(max-width: 768px) 100vw, (max-width: 900px) 50vw, 360px', alt: 'Mie Ayam Bakso', width: 700, height: 467 },
    description: { id: 'Mie ayam dengan topping bakso sapi dan pangsit renyah.', en: 'Chicken noodles topped with beef meatballs and crispy dumplings.' } },
  { id: 5, slug: 'esteh', name: 'Es Teh Manis', price: 5000, category: 'minuman',
    image: { src: 'images/es-teh-manis.jpg', srcset: 'images/es-teh-manis-480w.jpg 480w, images/es-teh-manis.jpg 700w', sizes: '(max-width: 768px) 100vw, (max-width: 900px) 50vw, 360px', alt: 'Es Teh Manis', width: 700, height: 467 },
    description: { id: 'Teh manis segar dengan es batu, pas untuk menemani makan siang.', en: 'Refreshing sweet tea with ice, perfect alongside lunch.' } },
  { id: 6, slug: 'esjeruk', name: 'Es Jeruk Peras', price: 8000, category: 'minuman',
    image: { src: 'images/es-jeruk-peras.jpg', srcset: 'images/es-jeruk-peras-480w.jpg 480w, images/es-jeruk-peras.jpg 700w', sizes: '(max-width: 768px) 100vw, (max-width: 900px) 50vw, 360px', alt: 'Es Jeruk Peras', width: 700, height: 467 },
    description: { id: 'Jeruk peras asli tanpa pemanis buatan, menyegarkan.', en: 'Genuine squeezed orange juice with no artificial sweeteners, refreshing.' } },
  { id: 7, slug: 'kopisusu', name: 'Kopi Susu Gula Aren', price: 15000, category: 'minuman',
    image: { src: 'images/kopi-susu-gula-aren.jpg', srcset: 'images/kopi-susu-gula-aren-480w.jpg 480w, images/kopi-susu-gula-aren.jpg 700w', sizes: '(max-width: 768px) 100vw, (max-width: 900px) 50vw, 360px', alt: 'Kopi Susu Gula Aren', width: 700, height: 467 },
    description: { id: 'Kopi susu dengan manis alami dari gula aren pilihan.', en: 'Milk coffee naturally sweetened with quality palm sugar.' } },
  { id: 8, slug: 'eskelapa', name: 'Es Kelapa Muda', price: 12000, category: 'minuman',
    image: { src: 'images/es-kelapa-muda.jpg', srcset: 'images/es-kelapa-muda-480w.jpg 480w, images/es-kelapa-muda.jpg 700w', sizes: '(max-width: 768px) 100vw, (max-width: 900px) 50vw, 360px', alt: 'Es Kelapa Muda', width: 700, height: 467 },
    description: { id: 'Kelapa muda asli dengan sedikit sirup gula merah.', en: 'Fresh young coconut with a touch of palm sugar syrup.' } },
  { id: 9, slug: 'pisanggoreng', name: 'Pisang Goreng Crispy', price: 10000, category: 'snack',
    image: { src: 'images/pisang-goreng-crispy.jpg', srcset: 'images/pisang-goreng-crispy-480w.jpg 480w, images/pisang-goreng-crispy.jpg 524w', sizes: '(max-width: 768px) 100vw, (max-width: 900px) 50vw, 360px', alt: 'Pisang Goreng Crispy', width: 700, height: 467 },
    description: { id: 'Pisang goreng renyah di luar, lembut di dalam. Isi 5 pcs.', en: 'Crispy on the outside, soft on the inside. 5 pieces per order.' } },
  { id: 10, slug: 'risoles', name: 'Risoles Mayo', price: 12000, category: 'snack',
    image: { src: 'images/risoles-mayo.jpg', srcset: 'images/risoles-mayo-480w.jpg 480w, images/risoles-mayo.jpg 700w', sizes: '(max-width: 768px) 100vw, (max-width: 900px) 50vw, 360px', alt: 'Risoles Mayo', width: 700, height: 467 },
    description: { id: 'Risoles isi sayuran dan mayo, cocok untuk camilan sore.', en: 'Risoles filled with vegetables and mayo, perfect for an afternoon snack.' } },
  { id: 11, slug: 'tahuisi', name: 'Tahu Isi', price: 8000, category: 'snack',
    image: { src: 'images/tahu-isi.jpg', srcset: 'images/tahu-isi-480w.jpg 480w, images/tahu-isi.jpg 525w', sizes: '(max-width: 768px) 100vw, (max-width: 900px) 50vw, 360px', alt: 'Tahu Isi', width: 700, height: 467 },
    description: { id: 'Tahu isi sayuran, digoreng renyah, disajikan dengan cabai rawit.', en: "Vegetable-stuffed tofu, fried crispy, served with bird's eye chilies." } },
];

// --- 3. Seed HANYA kalau table masih kosong (idempotent) ---
// `db.prepare(...)` menyiapkan statement SQL (bisa dipakai berulang),
// `.get()` menjalankannya dan mengambil SATU baris hasil (di sini: hitungan
// baris di table products).
//
// Kalau count > 0 berarti data sudah pernah di-seed sebelumnya (misal server
// sudah pernah dijalankan sekali) - maka seeding di-skip supaya tidak dobel.
// Ini penting karena kolom `slug` punya constraint UNIQUE: kalau kita insert
// data yang sama dua kali tanpa pengecekan ini, SQLite akan melempar error.
const row = db.prepare('SELECT COUNT(*) AS count FROM products').get();

if (row.count === 0) {
  // `db.transaction(...)` membungkus banyak INSERT jadi SATU transaksi -
  // artinya semua insert berhasil bersama-sama, atau kalau ada satu yang
  // gagal, semuanya dibatalkan (tidak ada data setengah-jadi). Ini juga
  // jauh lebih cepat daripada insert satu-satu di luar transaksi.
  const insert = db.prepare(`
    INSERT INTO products
      (id, slug, name, price, category, image_src, image_srcset, image_sizes, image_alt, image_width, image_height, description_id, description_en)
    VALUES
      (@id, @slug, @name, @price, @category, @image_src, @image_srcset, @image_sizes, @image_alt, @image_width, @image_height, @description_id, @description_en)
  `);

  const insertAll = db.transaction((products) => {
    for (const p of products) {
      insert.run({
        id: p.id,
        slug: p.slug,
        name: p.name,
        price: p.price,
        category: p.category,
        image_src: p.image.src,
        image_srcset: p.image.srcset,
        image_sizes: p.image.sizes,
        image_alt: p.image.alt,
        image_width: p.image.width,
        image_height: p.image.height,
        description_id: p.description.id,
        description_en: p.description.en,
      });
    }
  });

  insertAll(seedProducts);
  console.log(`[db] Seed selesai: ${seedProducts.length} produk dimasukkan ke table products.`);
} else {
  console.log(`[db] Table products sudah berisi ${row.count} baris, seeding dilewati.`);
}

// Ekspor koneksi `db` supaya server.js bisa pakai untuk query SELECT.
module.exports = { db };
