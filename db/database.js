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

// --- 2. Data seed: PERSIS 11 produk yang dulu hardcoded di server.js ---
// Disalin apa adanya (id, slug, name, price, category, image.*) - TIDAK ada
// data baru yang dikarang, supaya konsisten 100% dengan Phase 2B.
const seedProducts = [
  { id: 1, slug: 'nasigoreng', name: 'Nasi Goreng Spesial', price: 20000, category: 'makanan',
    image: { src: 'images/nasi-goreng-spesial.jpg', srcset: null, sizes: null, alt: 'Nasi Goreng Spesial', width: 700, height: 467 } },
  { id: 2, slug: 'ayamgeprek', name: 'Ayam Geprek Sambal Matah', price: 22000, category: 'makanan',
    image: { src: 'images/ayam-geprek-sambal-matah.jpg', srcset: null, sizes: null, alt: 'Ayam Geprek Sambal Matah', width: 700, height: 467 } },
  { id: 3, slug: 'sotoayam', name: 'Soto Ayam Kampung', price: 20000, category: 'makanan',
    image: { src: 'images/soto-ayam-kampung.jpg', srcset: 'images/soto-ayam-kampung-480w.jpg 480w, images/soto-ayam-kampung.jpg 700w', sizes: '(max-width: 768px) 100vw, (max-width: 900px) 50vw, 360px', alt: 'Soto Ayam Kampung', width: 700, height: 467 } },
  { id: 4, slug: 'mieayam', name: 'Mie Ayam Bakso', price: 18000, category: 'makanan',
    image: { src: 'images/mie-ayam-bakso.jpg', srcset: 'images/mie-ayam-bakso-480w.jpg 480w, images/mie-ayam-bakso.jpg 559w', sizes: '(max-width: 768px) 100vw, (max-width: 900px) 50vw, 360px', alt: 'Mie Ayam Bakso', width: 700, height: 467 } },
  { id: 5, slug: 'esteh', name: 'Es Teh Manis', price: 5000, category: 'minuman',
    image: { src: 'images/es-teh-manis.jpg', srcset: 'images/es-teh-manis-480w.jpg 480w, images/es-teh-manis.jpg 700w', sizes: '(max-width: 768px) 100vw, (max-width: 900px) 50vw, 360px', alt: 'Es Teh Manis', width: 700, height: 467 } },
  { id: 6, slug: 'esjeruk', name: 'Es Jeruk Peras', price: 8000, category: 'minuman',
    image: { src: 'images/es-jeruk-peras.jpg', srcset: 'images/es-jeruk-peras-480w.jpg 480w, images/es-jeruk-peras.jpg 700w', sizes: '(max-width: 768px) 100vw, (max-width: 900px) 50vw, 360px', alt: 'Es Jeruk Peras', width: 700, height: 467 } },
  { id: 7, slug: 'kopisusu', name: 'Kopi Susu Gula Aren', price: 15000, category: 'minuman',
    image: { src: 'images/kopi-susu-gula-aren.jpg', srcset: 'images/kopi-susu-gula-aren-480w.jpg 480w, images/kopi-susu-gula-aren.jpg 700w', sizes: '(max-width: 768px) 100vw, (max-width: 900px) 50vw, 360px', alt: 'Kopi Susu Gula Aren', width: 700, height: 467 } },
  { id: 8, slug: 'eskelapa', name: 'Es Kelapa Muda', price: 12000, category: 'minuman',
    image: { src: 'images/es-kelapa-muda.jpg', srcset: 'images/es-kelapa-muda-480w.jpg 480w, images/es-kelapa-muda.jpg 700w', sizes: '(max-width: 768px) 100vw, (max-width: 900px) 50vw, 360px', alt: 'Es Kelapa Muda', width: 700, height: 467 } },
  { id: 9, slug: 'pisanggoreng', name: 'Pisang Goreng Crispy', price: 10000, category: 'snack',
    image: { src: 'images/pisang-goreng-crispy.jpg', srcset: 'images/pisang-goreng-crispy-480w.jpg 480w, images/pisang-goreng-crispy.jpg 524w', sizes: '(max-width: 768px) 100vw, (max-width: 900px) 50vw, 360px', alt: 'Pisang Goreng Crispy', width: 700, height: 467 } },
  { id: 10, slug: 'risoles', name: 'Risoles Mayo', price: 12000, category: 'snack',
    image: { src: 'images/risoles-mayo.jpg', srcset: 'images/risoles-mayo-480w.jpg 480w, images/risoles-mayo.jpg 700w', sizes: '(max-width: 768px) 100vw, (max-width: 900px) 50vw, 360px', alt: 'Risoles Mayo', width: 700, height: 467 } },
  { id: 11, slug: 'tahuisi', name: 'Tahu Isi', price: 8000, category: 'snack',
    image: { src: 'images/tahu-isi.jpg', srcset: 'images/tahu-isi-480w.jpg 480w, images/tahu-isi.jpg 525w', sizes: '(max-width: 768px) 100vw, (max-width: 900px) 50vw, 360px', alt: 'Tahu Isi', width: 700, height: 467 } },
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
      (id, slug, name, price, category, image_src, image_srcset, image_sizes, image_alt, image_width, image_height)
    VALUES
      (@id, @slug, @name, @price, @category, @image_src, @image_srcset, @image_sizes, @image_alt, @image_width, @image_height)
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
