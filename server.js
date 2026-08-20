// server.js — Backend UMKM Sari Rasa, sekarang pakai Express.
// Sebelumnya kita nulis routing manual pakai if/else di atas modul `http` bawaan Node.
// Sekarang kita pindah ke Express: library yang membungkus `http` supaya penulisan
// route, JSON, dan penanganan error jadi lebih singkat dan rapi.

const express = require('express');
const cors = require('cors');
const { db } = require('./db/database');

const app = express();
const PORT = 3000;

// --- CORS (Cross-Origin Resource Sharing) ---
// Frontend jalan di http://localhost:5500 (Live Server), backend ini di
// http://localhost:3000 - beda PORT saja sudah dianggap browser sebagai
// "origin" yang berbeda. Secara default, browser MEMBLOKIR request fetch()
// dari satu origin ke origin lain (proteksi keamanan bawaan browser, supaya
// situs sembarangan tidak bisa diam-diam mengambil data dari server lain).
// Middleware ini membuat server EKSPLISIT mengizinkan request yang datang
// dari origin frontend kita. Sengaja dibatasi ke 'http://localhost:5500'
// saja (BUKAN '*'/semua origin), supaya API ini tidak bisa diakses bebas
// dari origin manapun - hanya frontend kita sendiri yang diizinkan.
// Dipasang SEBELUM route-route di bawah didefinisikan, supaya berlaku untuk
// semua request yang masuk.
app.use(cors({ origin: 'http://localhost:5500' }));

// --- JSON body parser ---
// Express (versi 5.x yang dipakai di project ini, lihat package.json) sudah
// menyertakan express.json() BAWAAN - tidak perlu install package terpisah
// `body-parser` seperti di versi Express lama/tutorial lama.
//
// Tanpa middleware ini, `req.body` akan `undefined` walaupun client (mis.
// Postman/curl) mengirim JSON di request body - Express tidak otomatis
// mem-parsing body request kalau middleware ini tidak dipasang.
// express.json() membaca raw request body (yang berbentuk teks/stream),
// mem-parsing-nya sebagai JSON, lalu mengisi `req.body` dengan object JS
// hasil parsing-nya, supaya route di bawah tinggal pakai `req.body.slug`,
// `req.body.price`, dst.
//
// Dipasang di sini (sebelum semua route) supaya berlaku untuk SEMUA route,
// termasuk POST /api/products di bawah.
app.use(express.json());

// --- Routes demo (lanjutan dari versi raw http, sekadar biar ada isinya) ---

app.get('/', (req, res) => {
  res.send('Selamat datang di Backend UMKM Sari Rasa!');
});

app.get('/menu', (req, res) => {
  const menu = [
    { nama: 'Nasi Goreng Sari Rasa', harga: 20000 },
    { nama: 'Ayam Bakar Madu', harga: 25000 },
    { nama: 'Es Teh Manis', harga: 5000 },
  ];
  res.json(menu);
});

app.get('/about', (req, res) => {
  res.send('Sari Rasa adalah UMKM kuliner rumahan yang berdiri sejak 2020, menyajikan masakan rumah dengan bahan segar setiap hari.');
});

// --- Route wajib Phase 1: health check ---
// Dipakai untuk mengecek apakah server hidup dan bisa merespons.
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Backend is running' });
});

// --- Route Phase 3A: daftar produk, sekarang diambil dari SQLite ---
// Bedanya dengan Phase 2B: dulu array 11 produk ditulis LANGSUNG di sini
// (hardcoded). Sekarang datanya sudah dipindah & disimpan di table
// `products` pada file database data/umkm.db (lihat db/database.js untuk
// schema table & proses seeding-nya).
//
// `db.prepare(sql)` menyiapkan SQL statement, `.all()` menjalankannya dan
// mengembalikan SEMUA baris hasil sebagai array of objects (satu object per
// baris, key-nya = nama kolom). `ORDER BY id` memastikan urutan produk yang
// dikirim ke frontend tetap 1-11 seperti sebelumnya (SQLite tidak menjamin
// urutan baris tanpa ORDER BY eksplisit).
//
// Kolom image_* di table (flat/rata) disusun ULANG di sini jadi object
// bersarang `image: { src, srcset, sizes, alt, width, height }` - supaya
// bentuk JSON yang dikirim ke frontend PERSIS SAMA seperti response Phase 2B.
// script.js (lihat createMenuCardElement()) mengakses product.image.src,
// product.image.srcset, dst, jadi struktur bersarang ini WAJIB dipertahankan
// walaupun di database-nya rata/flat.
app.get('/api/products', (req, res) => {
  const rows = db.prepare('SELECT * FROM products ORDER BY id').all();

  const products = rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    price: row.price,
    category: row.category,
    image: {
      src: row.image_src,
      srcset: row.image_srcset, // NULL di SQLite otomatis jadi `null` di JS
      sizes: row.image_sizes,   // sama seperti nilai asli hardcoded dulu
      alt: row.image_alt,
      width: row.image_width,
      height: row.image_height,
    },
  }));

  res.json(products);
});

// --- Route Phase 3B-1: tambah produk baru (CREATE) ---
// Bedanya dengan GET di atas (yang cuma MEMBACA data): route ini MENULIS
// baris baru ke table `products`. Method HTTP yang dipakai untuk "buat
// resource baru" secara konvensi adalah POST (GET untuk baca, POST untuk
// buat, PUT/PATCH untuk ubah, DELETE untuk hapus - tapi di phase ini kita
// CUMA bikin POST, yang lain sengaja belum ada).
//
// Data produk baru dikirim client lewat request body (JSON) - itu sebabnya
// middleware express.json() di atas WAJIB dipasang duluan, supaya
// `req.body` sudah berisi object hasil parsing JSON saat kode ini jalan.
app.post('/api/products', (req, res) => {
  // req.body bisa `undefined`/`{}` kalau client tidak mengirim body sama
  // sekali atau Content-Type-nya bukan application/json - fallback ke {}
  // supaya destructuring di bawah tidak error.
  const body = req.body || {};
  const { slug, name, price, category, image } = body;

  // Sengaja TIDAK mengambil `id` dari body sama sekali. Client BOLEH kirim
  // `id` di JSON-nya, tapi kita abaikan total - karena kolom `id` di table
  // adalah INTEGER PRIMARY KEY, SQLite yang menentukan nilainya sendiri
  // (auto-increment) saat INSERT tanpa kolom id disebutkan. Ini penting
  // untuk keamanan/konsistensi: kalau client bebas menentukan id, dia bisa
  // saja mengirim id yang sudah dipakai produk lain dan bikin data bentrok.

  const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;
  const isPositiveNumber = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;

  // --- Validasi field wajib ---
  // Daftar field wajib ini dicocokkan dengan kolom NOT NULL di schema
  // Phase 3A (lihat db/database.js): slug, name, price, category, image_src,
  // image_alt, image_width, image_height semuanya NOT NULL. image_srcset
  // dan image_sizes NULLABLE, jadi boleh kosong/tidak dikirim.
  const errors = [];

  if (!isNonEmptyString(slug)) {
    errors.push('slug wajib diisi berupa teks dan tidak boleh kosong/spasi saja');
  }
  if (!isNonEmptyString(name)) {
    errors.push('name wajib diisi berupa teks dan tidak boleh kosong/spasi saja');
  }
  if (!isNonEmptyString(category)) {
    errors.push('category wajib diisi berupa teks dan tidak boleh kosong/spasi saja');
  }
  // price wajib angka valid (bukan string, bukan NaN) dan tidak boleh negatif.
  // `typeof price !== 'number'` sudah otomatis menolak string seperti "abc"
  // ATAU string angka seperti "18000" (harus dikirim sebagai number di JSON,
  // bukan string) - `Number.isFinite` menolak NaN/Infinity.
  if (typeof price !== 'number' || !Number.isFinite(price) || price < 0) {
    errors.push('price wajib berupa angka (number), tidak boleh negatif, dan tidak boleh NaN');
  }
  if (!image || typeof image !== 'object') {
    errors.push('image wajib diisi berupa object berisi src, alt, width, height');
  } else {
    if (!isNonEmptyString(image.src)) {
      errors.push('image.src wajib diisi berupa teks dan tidak boleh kosong/spasi saja');
    }
    if (!isNonEmptyString(image.alt)) {
      errors.push('image.alt wajib diisi berupa teks dan tidak boleh kosong/spasi saja');
    }
    if (!isPositiveNumber(image.width)) {
      errors.push('image.width wajib berupa angka positif');
    }
    if (!isPositiveNumber(image.height)) {
      errors.push('image.height wajib berupa angka positif');
    }
  }

  // Kalau ada field yang tidak valid, HENTIKAN di sini - jangan lanjut ke
  // INSERT sama sekali. HTTP 400 Bad Request = "request kamu salah/tidak
  // lengkap", beda dengan 500 yang berarti "server kami yang error".
  if (errors.length > 0) {
    return res.status(400).json({ error: 'Validasi gagal', details: errors });
  }

  // --- Cek slug unik SEBELUM insert ---
  // Kolom slug punya constraint UNIQUE di table (lihat db/database.js).
  // Dicek manual dulu di sini supaya pesan errornya jelas/ramah. `.get()`
  // ambil SATU baris (atau `undefined` kalau tidak ketemu).
  const existing = db.prepare('SELECT id FROM products WHERE slug = ?').get(slug);
  if (existing) {
    return res.status(409).json({ error: `Produk dengan slug '${slug}' sudah dipakai` });
  }

  try {
    // --- Parameterized INSERT (WAJIB, anti SQL injection) ---
    // Perhatikan: SQL string di bawah HANYA berisi placeholder (@slug,
    // @name, dst), TIDAK ADA nilai dari req.body yang ditempel langsung ke
    // string SQL (concatenation). Nilai sebenarnya dikirim TERPISAH lewat
    // object kedua di `.run({...})`. better-sqlite3/SQLite yang menyisipkan
    // nilai itu dengan aman ke tempatnya - kalau ada user iseng mengirim
    // slug berisi potongan SQL (mis. `"x'); DROP TABLE products; --"`), itu
    // akan diperlakukan MURNI sebagai teks slug biasa, bukan dieksekusi
    // sebagai perintah SQL.
    const insert = db.prepare(`
      INSERT INTO products
        (slug, name, price, category, image_src, image_srcset, image_sizes, image_alt, image_width, image_height)
      VALUES
        (@slug, @name, @price, @category, @image_src, @image_srcset, @image_sizes, @image_alt, @image_width, @image_height)
    `);

    const info = insert.run({
      slug,
      name,
      price,
      category,
      image_src: image.src,
      // ?? null: kalau client tidak mengirim srcset/sizes sama sekali
      // (undefined) ATAU eksplisit mengirim null, dua-duanya disimpan
      // sebagai NULL di SQLite - konsisten dengan kolom nullable di schema.
      image_srcset: image.srcset ?? null,
      image_sizes: image.sizes ?? null,
      image_alt: image.alt,
      image_width: image.width,
      image_height: image.height,
    });

    // `info.lastInsertRowid` = id yang baru saja di-generate SQLite untuk
    // baris ini (karena id adalah INTEGER PRIMARY KEY / auto-increment).
    // Kita SELECT ulang baris itu supaya response ke client berisi data
    // PERSIS seperti yang tersimpan di database (bukan cuma menebak-nebak
    // dari req.body).
    const newRow = db.prepare('SELECT * FROM products WHERE id = ?').get(info.lastInsertRowid);

    // Susun ulang jadi bentuk nested `image: {...}` - KONSISTEN dengan
    // struktur response GET /api/products di atas (bukan flat image_src dkk).
    const newProduct = {
      id: newRow.id,
      slug: newRow.slug,
      name: newRow.name,
      price: newRow.price,
      category: newRow.category,
      image: {
        src: newRow.image_src,
        srcset: newRow.image_srcset,
        sizes: newRow.image_sizes,
        alt: newRow.image_alt,
        width: newRow.image_width,
        height: newRow.image_height,
      },
    };

    // 201 Created = standar HTTP untuk "resource baru berhasil dibuat".
    res.status(201).json({ message: 'Produk berhasil dibuat', product: newProduct });
  } catch (err) {
    // Jaga-jaga race condition (dua request POST slug sama nyaris bersamaan,
    // lolos cek existing di atas tapi bentrok saat INSERT) - better-sqlite3
    // melempar error dengan `code === 'SQLITE_CONSTRAINT_UNIQUE'` kalau
    // constraint UNIQUE dilanggar.
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: `Produk dengan slug '${slug}' sudah dipakai` });
    }

    // Untuk error database lain yang tak terduga: JANGAN kirim err.message
    // atau err.stack ke client (bisa membocorkan detail internal seperti
    // struktur table/nama file/versi library - informasi yang bisa
    // dimanfaatkan orang jahat). Detail lengkapnya cukup di-log ke console
    // server untuk kita debug sendiri; client cuma dapat pesan aman + 500.
    console.error('[POST /api/products] Gagal insert produk:', err);
    res.status(500).json({ error: 'Terjadi kesalahan pada server' });
  }
});

// --- 404 handler ---
// Jalan kalau tidak ada route di atas yang cocok dengan request-nya.
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

// --- Error handler ---
// Jalan kalau ada route yang melempar error (lewat `next(err)` atau exception).
// Middleware ini dikenali Express karena punya 4 parameter (err, req, res, next).
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal Server Error' });
});

app.listen(PORT, () => {
  console.log(`Server jalan di http://localhost:${PORT}`);
});
