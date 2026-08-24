// server.js — Backend UMKM Sari Rasa, sekarang pakai Express.
// Sebelumnya kita nulis routing manual pakai if/else di atas modul `http` bawaan Node.
// Sekarang kita pindah ke Express: library yang membungkus `http` supaya penulisan
// route, JSON, dan penanganan error jadi lebih singkat dan rapi.

const express = require('express');
const cors = require('cors');
const { db } = require('./db/database');
const { hashPassword, verifyPassword } = require('./lib/password');
const { normalizeEmail, findUserByEmail } = require('./lib/user');
const { sign, COOKIE_NAME, MAX_AGE_MS } = require('./lib/session');
const { requireAuth } = require('./middleware/auth');
const { requireAdmin } = require('./middleware/authorize');

const app = express();
const PORT = 3000;

// --- Dummy hash untuk timing-safety anti-enumeration email (Phase 3C-2) ---
// Dipakai di POST /api/auth/login: kalau email yang di-submit TIDAK ADA di
// database, kita tetap menjalankan bcrypt.compare() (dengan hash dummy ini)
// alih-alih langsung membalas 401 lebih cepat. Tanpa ini, "email tidak
// terdaftar" akan konsisten lebih CEPAT dibalas dibanding "email ada tapi
// password salah" (yang harus menunggu bcrypt.compare selesai) - selisih
// waktu ini bisa dimanfaatkan penyerang untuk menebak/enumerasi email mana
// saja yang terdaftar, tanpa perlu tahu passwordnya sama sekali.
//
// Hash ini BUKAN milik akun/user nyata siapa pun - dihasilkan sekali secara
// terpisah dari string acak "dummy-password-for-timing-safety-check" (lihat
// cara generate di komentar bawah), jadi aman ditulis langsung di kode
// (bukan secret, tidak perlu di .env). bcrypt.compare() terhadap hash ini
// akan SELALU false untuk password apa pun - tujuannya cuma supaya durasi
// pemrosesannya sebanding dengan bcrypt.compare() yang sesungguhnya.
//
// Cost factor di hash ini (terlihat dari segmen "$2b$12$...") HARUS SAMA
// dengan SALT_ROUNDS di lib/password.js (=12) - kalau beda, waktu proses
// bcrypt.compare() untuk dummy ini tidak akan sebanding dengan yang asli,
// dan tujuan anti-timing-attack di atas jadi tidak tercapai.
//
// Cara generate ulang kalau perlu:
//   node -e "require('bcrypt').hash('dummy-password-for-timing-safety-check', 12).then(console.log)"
const DUMMY_HASH_FOR_TIMING_SAFETY = '$2b$12$tCZ5/9bVxxS72ULyLr8aUupeZ9np8eAciQ8xf0ZD7luJF11V3iqDG';

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
//
// `credentials: true` (Phase 3C-3): browser secara default TIDAK menyertakan
// cookie sama sekali pada request cross-origin (beda origin seperti frontend
// :5500 ke backend :3000 di project ini), KECUALI server secara eksplisit
// mengizinkannya lewat opsi ini (yang membuat cors mengirim header response
// `Access-Control-Allow-Credentials: true`). Tanpa `credentials: true` di
// sini, cookie session yang di-set di POST /api/auth/login TIDAK AKAN PERNAH
// terkirim balik ke server pada request berikutnya dari frontend manapun -
// requireAuth akan selalu menganggap user belum login walau baru saja login
// sukses. (Catatan: sisi frontend/fetch() juga tetap harus menyertakan
// `credentials: 'include'` supaya cookie ikut terkirim - itu di luar scope
// perubahan server.js ini, disebutkan di sini sebagai pengingat.)
app.use(cors({ origin: 'http://localhost:5500', credentials: true }));

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
// --- Helper Phase 3B-2: susun ulang satu row database jadi bentuk product ---
// Baik GET /api/products (banyak baris) maupun GET /api/products/:id (satu
// baris) BUTUH transformasi yang SAMA PERSIS: kolom flat image_* di table
// disusun ulang jadi object bersarang `image: {...}`. Daripada tulis ulang
// object literal ini dua kali (dan berisiko suatu saat cuma salah satu yang
// diupdate kalau ada perubahan struktur), logikanya di-extract jadi satu
// function kecil yang dipanggil dari dua tempat. Ini BUKAN "refactor besar" -
// cuma memindahkan literal object yang sudah ada ke sebuah function, tanpa
// mengubah sedikit pun nilai/urutan field yang dihasilkan.
function mapRowToProduct(row) {
  return {
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
  };
}

app.get('/api/products', (req, res) => {
  // --- Phase 3B-5: dibungkus try/catch supaya KONSISTEN dengan endpoint lain ---
  // Sebelumnya route ini TIDAK punya try/catch sama sekali (beda dengan
  // GET/POST/PUT/DELETE /api/products/:id yang semuanya sudah punya). Kalau
  // query di bawah gagal (misal file database korup/terkunci), tanpa
  // try/catch ini Express 5 tetap otomatis menangkapnya lewat error handler
  // global di akhir file - TAPI supaya pesan log-nya jelas menyebut endpoint
  // mana yang gagal (sama seperti pola di endpoint lain), errornya ditangkap
  // eksplisit di sini juga.
  try {
    const rows = db.prepare('SELECT * FROM products ORDER BY id').all();
    const products = rows.map(mapRowToProduct);
    res.json(products);
  } catch (err) {
    console.error('[GET /api/products] Gagal ambil daftar produk:', err);
    res.status(500).json({ status: 'error', message: 'Terjadi kesalahan pada server' });
  }
});

// --- Route Phase 3B-2: ambil SATU produk berdasarkan ID (READ single) ---
// Bedanya dengan GET /api/products di atas (yang ambil SEMUA produk): route
// ini menerima id lewat URL, misal GET /api/products/5, lalu cuma
// mengembalikan SATU product yang id-nya cocok (atau 404 kalau tidak ada).
//
// `:id` di path adalah ROUTE PARAMETER - placeholder di URL yang nilainya
// ditangkap Express dan dimasukkan ke `req.params.id`. Kalau client request
// GET /api/products/5, maka req.params.id === '5' (STRING, bukan number -
// semua bagian URL selalu berupa teks, walaupun isinya kelihatan seperti
// angka).
app.get('/api/products/:id', (req, res) => {
  // --- Validasi format id SEBELUM dipakai untuk query database ---
  // req.params.id masih berupa string mentah dari URL, jadi harus dicek dulu
  // apakah dia representasi angka bulat positif yang valid, sebelum dipakai
  // sebagai primary key integer. Ditolak semua yang: bukan angka sama sekali
  // ("abc"), desimal ("1.5"), negatif ("-1"), atau nol ("0") - karena kolom
  // `id` di table adalah INTEGER PRIMARY KEY yang di-generate mulai dari 1.
  //
  // Number(...) mengubah string jadi number ("abc" -> NaN, "1.5" -> 1.5,
  // "-1" -> -1, "5" -> 5). Number.isInteger menolak NaN dan desimal
  // sekaligus. Ditambah cek `> 0` untuk menolak 0/negatif.
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ status: 'error', message: `ID produk '${req.params.id}' tidak valid, harus berupa angka bulat positif` });
  }

  try {
    // --- Parameterized query, ambil SATU baris saja ---
    // Bedanya dengan `.all()` di GET /api/products: `.get()` cuma
    // mengembalikan baris PERTAMA yang cocok (atau `undefined` kalau tidak
    // ada baris yang cocok sama sekali) - cocok karena `id` adalah PRIMARY
    // KEY, jadi paling banyak cuma ada satu baris yang bisa match.
    //
    // `WHERE id = ?` + argumen terpisah di `.get(id)` (BUKAN ditempel
    // langsung ke string SQL) - prinsip yang sama seperti INSERT di POST
    // /api/products: mencegah SQL injection, karena nilai `id` diperlakukan
    // murni sebagai DATA oleh SQLite, bukan bagian dari perintah SQL.
    const row = db.prepare('SELECT * FROM products WHERE id = ?').get(id);

    if (!row) {
      // 404 Not Found: format id-nya VALID (angka bulat positif), tapi
      // tidak ada produk dengan id tersebut di database. Beda dengan 400 di
      // atas (format request-nya sendiri yang salah).
      return res.status(404).json({ status: 'error', message: `Produk dengan id ${id} tidak ditemukan` });
    }

    res.json(mapRowToProduct(row));
  } catch (err) {
    // Konsisten dengan pola error handling di POST /api/products: detail
    // error database di-log ke console server saja, client cukup dapat
    // pesan generik + 500, supaya tidak membocorkan detail internal.
    console.error('[GET /api/products/:id] Gagal ambil produk:', err);
    res.status(500).json({ status: 'error', message: 'Terjadi kesalahan pada server' });
  }
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
// --- Phase 3C-3: requireAuth, requireAdmin dipasang di ketiga route mutasi produk ---
// Ketiga route CREATE/UPDATE/DELETE produk di bawah (POST, PUT, DELETE) kini
// WAJIB login DAN role admin - alasannya: route-route ini MENGUBAH data yang
// tampil ke SEMUA pengunjung situs (lewat GET /api/products publik), jadi
// tidak boleh sembarang orang bisa memanggilnya. requireAuth jalan dulu
// (pastikan ada user yang login sah), baru requireAdmin (pastikan user itu
// role-nya admin) - urutan ini penting, requireAdmin bergantung pada
// req.user yang diisi requireAuth (lihat komentar di middleware/authorize.js).
// GET /api/products dan GET /api/products/:id SENGAJA TIDAK disentuh -
// melihat daftar produk tetap publik, tidak butuh login sama sekali.
app.post('/api/products', requireAuth, requireAdmin, (req, res) => {
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
    return res.status(400).json({ status: 'error', message: 'Validasi gagal', details: errors });
  }

  // --- Cek slug unik SEBELUM insert ---
  // Kolom slug punya constraint UNIQUE di table (lihat db/database.js).
  // Dicek manual dulu di sini supaya pesan errornya jelas/ramah. `.get()`
  // ambil SATU baris (atau `undefined` kalau tidak ketemu).
  const existing = db.prepare('SELECT id FROM products WHERE slug = ?').get(slug);
  if (existing) {
    return res.status(409).json({ status: 'error', message: `Produk dengan slug '${slug}' sudah dipakai` });
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
      return res.status(409).json({ status: 'error', message: `Produk dengan slug '${slug}' sudah dipakai` });
    }

    // Untuk error database lain yang tak terduga: JANGAN kirim err.message
    // atau err.stack ke client (bisa membocorkan detail internal seperti
    // struktur table/nama file/versi library - informasi yang bisa
    // dimanfaatkan orang jahat). Detail lengkapnya cukup di-log ke console
    // server untuk kita debug sendiri; client cuma dapat pesan aman + 500.
    console.error('[POST /api/products] Gagal insert produk:', err);
    res.status(500).json({ status: 'error', message: 'Terjadi kesalahan pada server' });
  }
});

// --- Route Phase 3B-3: update produk yang SUDAH ADA (UPDATE / full replace) ---
// Bedanya dengan POST di atas (yang MEMBUAT baris baru): route ini MENGUBAH
// baris yang sudah ada, dicari berdasarkan id di URL. Method HTTP yang
// dipakai untuk "ubah resource yang sudah ada" secara konvensi adalah PUT
// (atau PATCH untuk update sebagian - tapi PATCH SENGAJA belum dibuat di
// phase ini, di luar scope).
//
// PUT secara konvensi HTTP berarti FULL REPLACE: client WAJIB mengirim
// SEMUA field (slug, name, price, category, image lengkap), bukan cuma
// field yang mau diubah. Kalau cuma mau ubah price saja tapi lupa mengirim
// name, request ini akan DITOLAK 400 (bukan dianggap "name tidak berubah").
// Itu sebabnya validasi di bawah PERSIS memakai pola "wajib" yang sama
// seperti POST /api/products - bukan validasi yang lebih longgar.
// Phase 3C-3: requireAuth + requireAdmin - lihat komentar di atas POST /api/products.
app.put('/api/products/:id', requireAuth, requireAdmin, (req, res) => {
  // --- Validasi format id, SAMA PERSIS dengan GET /api/products/:id ---
  // Dilakukan PALING AWAL, sebelum menyentuh database sama sekali - kalau
  // id di URL saja sudah tidak valid, tidak ada gunanya lanjut query.
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ status: 'error', message: `ID produk '${req.params.id}' tidak valid, harus berupa angka bulat positif` });
  }

  try {
    // --- Pastikan produk dengan id ini benar-benar ada, SEBELUM update ---
    // Tanpa cek ini, UPDATE ... WHERE id = ? terhadap id yang tidak ada di
    // database tidak akan error - SQLite cuma diam-diam "mengubah 0 baris"
    // (info.changes === 0), yang kalau tidak dicek akan terkesan seperti
    // sukses padahal tidak ada apa-apa yang terjadi. SELECT dulu di sini
    // memastikan kita bisa balas 404 yang jelas SEBELUM melakukan UPDATE
    // apa pun, konsisten dengan pola GET /api/products/:id.
    const existingRow = db.prepare('SELECT * FROM products WHERE id = ?').get(id);

    if (!existingRow) {
      return res.status(404).json({ status: 'error', message: `Produk dengan id ${id} tidak ditemukan` });
    }

    // req.body bisa `undefined`/`{}` kalau client tidak mengirim body sama
    // sekali - fallback ke {} supaya destructuring di bawah tidak error.
    const body = req.body || {};
    const { slug, name, price, category, image } = body;

    // PENTING: `id` dari req.body (kalau client mengirimnya) SENGAJA TIDAK
    // PERNAH dibaca/dipakai di route ini. Satu-satunya sumber kebenaran
    // untuk "produk mana yang di-update" adalah `req.params.id` (dari URL)
    // yang sudah divalidasi & dipakai di atas. Kalau client mengirim
    // `{"id": 9999, ...}` ke PUT /api/products/5, baris yang berubah tetap
    // id=5 - nilai 9999 di body diabaikan total (tidak pernah muncul lagi
    // di kode di bawah ini).

    const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;
    const isPositiveNumber = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;

    // --- Validasi field wajib, SAMA PERSIS pola/semangatnya dengan POST ---
    // PUT = full replace, jadi SEMUA field ini tetap wajib diisi lengkap
    // (bukan partial/opsional seperti PATCH yang belum ada di phase ini).
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

    // Kalau ADA SATU SAJA field yang tidak valid, HENTIKAN di sini - jangan
    // lanjut ke UPDATE sama sekali (all-or-nothing, bukan partial update).
    // Baris existingRow yang sudah di-SELECT di atas TIDAK disentuh/ditulis
    // ulang ke database - jadi data lama otomatis tetap utuh tanpa perlu
    // rollback apa pun.
    if (errors.length > 0) {
      return res.status(400).json({ status: 'error', message: 'Validasi gagal', details: errors });
    }

    // --- Cek slug unik SEBELUM update, TAPI kecualikan produk ini sendiri ---
    // Bedanya dengan cek slug di POST: di POST tidak ada "diri sendiri" untuk
    // dikecualikan (produknya belum ada). Di PUT, produk yang SEDANG
    // di-update boleh saja "update ke slug yang sama seperti sebelumnya"
    // (misal client kirim ulang slug lama tanpa berubah) - itu BUKAN
    // konflik. Makanya query di bawah pakai `AND id != ?`: cari slug yang
    // sama tapi DIMILIKI PRODUK LAIN (id berbeda). Kalau ketemu, baru
    // dianggap konflik.
    const slugConflict = db.prepare('SELECT id FROM products WHERE slug = ? AND id != ?').get(slug, id);
    if (slugConflict) {
      return res.status(409).json({ status: 'error', message: `Produk dengan slug '${slug}' sudah dipakai` });
    }

    // --- Parameterized UPDATE (WAJIB, anti SQL injection) ---
    // Sama seperti INSERT di POST: SQL string di bawah HANYA berisi
    // placeholder (@slug, @name, dst, @id), nilai sebenarnya dikirim
    // TERPISAH lewat object di `.run({...})` - bukan ditempel langsung ke
    // string SQL. `WHERE id = @id` memastikan HANYA baris dengan id ini
    // yang berubah, baris produk lain tidak tersentuh sama sekali.
    const update = db.prepare(`
      UPDATE products SET
        slug = @slug,
        name = @name,
        price = @price,
        category = @category,
        image_src = @image_src,
        image_srcset = @image_srcset,
        image_sizes = @image_sizes,
        image_alt = @image_alt,
        image_width = @image_width,
        image_height = @image_height
      WHERE id = @id
    `);

    update.run({
      id,
      slug,
      name,
      price,
      category,
      image_src: image.src,
      // ?? null: konsisten dengan POST - srcset/sizes yang tidak dikirim
      // (undefined) atau eksplisit null, dua-duanya disimpan sebagai NULL.
      image_srcset: image.srcset ?? null,
      image_sizes: image.sizes ?? null,
      image_alt: image.alt,
      image_width: image.width,
      image_height: image.height,
    });

    // SELECT ulang baris yang baru saja di-update, supaya response ke
    // client berisi data PERSIS seperti yang tersimpan di database.
    // mapRowToProduct() dipakai lagi di sini (helper yang sama yang dipakai
    // GET /api/products & GET /api/products/:id) - TIDAK menulis ulang
    // logic penyusunan object image dari nol.
    const updatedRow = db.prepare('SELECT * FROM products WHERE id = ?').get(id);

    res.json({ message: 'Produk berhasil diupdate', product: mapRowToProduct(updatedRow) });
  } catch (err) {
    // Lapis kedua jaga-jaga race condition: dua request PUT dengan slug
    // baru yang sama nyaris bersamaan bisa lolos cek slugConflict di atas
    // tapi bentrok saat UPDATE benar-benar dijalankan. better-sqlite3
    // melempar error dengan `code === 'SQLITE_CONSTRAINT_UNIQUE'` kalau
    // constraint UNIQUE pada kolom slug dilanggar.
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ status: 'error', message: `Produk dengan slug '${req.body?.slug}' sudah dipakai` });
    }

    // Error database lain yang tak terduga: JANGAN kirim err.message/stack
    // ke client, cukup log ke console server + pesan generik + 500,
    // konsisten dengan pola POST /api/products.
    console.error('[PUT /api/products/:id] Gagal update produk:', err);
    res.status(500).json({ status: 'error', message: 'Terjadi kesalahan pada server' });
  }
});

// --- Route Phase 3B-4: hapus produk berdasarkan ID (DELETE) ---
// Bedanya dengan GET/POST/PUT di atas: route ini MENGHAPUS baris dari table
// secara PERMANEN (bukan cuma "menandai" produk sebagai tidak aktif/soft-
// delete). Method HTTP yang dipakai untuk "hapus resource" secara konvensi
// adalah DELETE. Dengan ini, keempat operasi CRUD (Create/Read/Update/
// Delete) sudah lengkap: POST=Create, GET=Read, PUT=Update, DELETE=Delete.
//
// DELETE tidak butuh request body sama sekali - satu-satunya informasi yang
// dibutuhkan cuma "produk MANA yang mau dihapus", dan itu sudah cukup
// didapat dari id di URL (req.params.id).
// Phase 3C-3: requireAuth + requireAdmin - lihat komentar di atas POST /api/products.
app.delete('/api/products/:id', requireAuth, requireAdmin, (req, res) => {
  // --- Validasi format id, SAMA PERSIS dengan GET/PUT /api/products/:id ---
  // Dilakukan PALING AWAL, SEBELUM menyentuh database sama sekali - kalau id
  // di URL saja sudah tidak valid formatnya, tidak ada gunanya (dan tidak
  // aman) lanjut ke query apa pun, apalagi query DELETE.
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ status: 'error', message: `ID produk '${req.params.id}' tidak valid, harus berupa angka bulat positif` });
  }

  // PENTING: `id` yang dipakai di seluruh route ini SELALU berasal dari
  // req.params.id (URL), TIDAK PERNAH dari req.body. Client BOLEH saja
  // mengirim body seperti `{"id": 9999}` di request DELETE, tapi body itu
  // TIDAK PERNAH dibaca sama sekali di route ini - req.body bahkan tidak
  // disentuh di bawah. Kalau client kirim DELETE /api/products/5 dengan
  // body `{"id": 9999}`, yang dihapus tetap produk id=5 (dari URL), BUKAN
  // id=9999 (dari body).

  try {
    // --- Existence check SEBELUM delete ---
    // Sama seperti PUT: tanpa cek ini, `DELETE FROM products WHERE id = ?`
    // terhadap id yang tidak ada di database TIDAK akan error - SQLite cuma
    // diam-diam "menghapus 0 baris". Supaya bisa membedakan dengan jelas
    // "404 produk tidak ada" vs "204 berhasil dihapus", kita SELECT dulu di
    // sini untuk memastikan produknya benar-benar ada SEBELUM DELETE
    // dijalankan.
    const existingRow = db.prepare('SELECT id FROM products WHERE id = ?').get(id);

    if (!existingRow) {
      return res.status(404).json({ status: 'error', message: `Produk dengan id ${id} tidak ditemukan` });
    }

    // --- Parameterized DELETE (WAJIB, anti SQL injection) ---
    // Sama seperti INSERT/UPDATE di POST/PUT: `WHERE id = ?` + argumen
    // terpisah di `.run(id)` (BUKAN ditempel langsung ke string SQL/string
    // concatenation). Nilai `id` diperlakukan MURNI sebagai data oleh
    // SQLite, bukan bagian dari perintah SQL - jadi walaupun ada yang
    // mencoba mengirim sesuatu seperti "1;DROP TABLE products--" di URL,
    // nilai itu akan gagal di validasi Number.isInteger di atas (bukan
    // angka murni) dan tidak akan pernah sampai ke query ini.
    db.prepare('DELETE FROM products WHERE id = ?').run(id);

    // --- 204 No Content: sukses, TANPA body sama sekali ---
    // Beda dengan 200/201 yang biasanya diikuti JSON body berisi data hasil
    // operasi: 204 secara konvensi HTTP berarti "berhasil, tapi memang tidak
    // ada apa pun yang perlu dikirim balik" - masuk akal untuk DELETE, karena
    // resource-nya sudah tidak ada lagi untuk ditampilkan. res.status(204)
    // .end() memastikan response BENAR-BENAR tidak punya body (beda dengan
    // res.status(204).json(...) yang tetap mengisi body walau statusnya 204,
    // yang menyalahi konvensi HTTP untuk status 204).
    res.status(204).end();
  } catch (err) {
    // Error database lain yang tak terduga: JANGAN kirim err.message/stack ke
    // client, cukup log ke console server + pesan generik + 500, konsisten
    // dengan pola GET/POST/PUT di atas.
    console.error('[DELETE /api/products/:id] Gagal hapus produk:', err);
    res.status(500).json({ status: 'error', message: 'Terjadi kesalahan pada server' });
  }
});

// --- Route Phase 3C-2: registrasi akun baru (CREATE user) ---
// Bedanya dengan CRUD /api/products di atas: yang disimpan di sini adalah
// KREDENSIAL akun (email + password), jadi ada dua langkah tambahan yang
// tidak ada di /api/products: (1) password TIDAK PERNAH disimpan
// apa adanya - selalu di-hash dulu lewat hashPassword() (lib/password.js,
// Phase 3C-1) sebelum masuk ke kolom password_hash; (2) email dinormalisasi
// (normalizeEmail(), lib/user.js) supaya "User@Mail.com" dan "user@mail.com"
// dianggap akun yang sama, konsisten dengan constraint UNIQUE di kolom email.
app.post('/api/auth/register', async (req, res) => {
  // req.body bisa `undefined`/`{}` kalau client tidak mengirim body sama
  // sekali - fallback ke {} supaya destructuring di bawah tidak error,
  // konsisten dengan pola di POST/PUT /api/products.
  const { email, password } = req.body || {};

  // --- Validasi field, pola SAMA PERSIS seperti POST /api/products: ---
  // kumpulkan semua pesan error ke array `errors`, baru dibalas SEKALIGUS
  // sebagai 400 kalau ada yang tidak valid (bukan berhenti di error pertama)
  // - supaya client langsung tahu SEMUA yang perlu diperbaiki dalam satu
  // response, tidak perlu coba-coba berkali-kali satu per satu.
  const errors = [];

  // Regex email di bawah SENGAJA sederhana (cuma cek ada "sesuatu@sesuatu.
  // sesuatu", tanpa spasi) - bukan validasi RFC 5322 lengkap yang super rumit.
  // Cukup untuk menyaring input yang jelas-jelas bukan email, validasi
  // "beneran ada"/deliverable tetap lewat proses lain (verifikasi email) yang
  // di luar scope Phase 3C-2 ini.
  const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (email === undefined || email === null) {
    errors.push('email wajib diisi');
  } else if (typeof email !== 'string') {
    errors.push('email wajib berupa teks');
  } else if (email.trim().length === 0) {
    errors.push('email tidak boleh kosong/spasi saja');
  } else if (!EMAIL_REGEX.test(email.trim())) {
    errors.push('email harus berformat valid, contoh: nama@contoh.com');
  }

  // Password SENGAJA TIDAK di-trim sebelum divalidasi/disimpan - beda dengan
  // email di atas. Spasi di awal/akhir password BISA jadi bagian yang
  // sengaja diketik user (password manager sering menghasilkan password
  // dengan karakter apa saja termasuk spasi), jadi menghapusnya diam-diam
  // sama saja mengubah password yang sebenarnya dimaksud user.
  if (password === undefined || password === null) {
    errors.push('password wajib diisi');
  } else if (typeof password !== 'string') {
    errors.push('password wajib berupa teks');
  } else if (password.length === 0) {
    errors.push('password tidak boleh kosong');
  } else if (password.trim().length === 0) {
    // `.trim()` di sini CUMA dipakai untuk pengecekan ini - password yang
    // isinya cuma spasi (misal 8 spasi) tetap punya `.length >= 8` sehingga
    // lolos dua cek di atas maupun cek panjang minimum di bawah, padahal
    // secara efektif kosong. Nilai `password` ASLI (belum di-trim) tetap
    // yang dipakai untuk hashPassword()/disimpan - konsisten dengan
    // keputusan di atas bahwa spasi di awal/akhir password TIDAK dihapus
    // diam-diam.
    errors.push('password tidak boleh kosong (hanya berisi spasi)');
  } else if (password.length < 8) {
    // Catatan: `.length` biasa di sini (BUKAN Buffer.byteLength seperti di
    // lib/password.js) - ini aturan bisnis yang BEDA: batas MINIMUM panjang
    // password (supaya tidak terlalu lemah), bukan batas MAKSIMUM byte
    // bcrypt (72 byte, yang sudah ditangani sendiri oleh hashPassword()).
    // Dua aturan ini sengaja tidak digabung supaya masing-masing tetap jelas
    // tanggung jawabnya.
    errors.push('password minimal 8 karakter');
  }

  if (errors.length > 0) {
    return res.status(400).json({ status: 'error', message: 'Validasi gagal', details: errors });
  }

  const normalizedEmail = normalizeEmail(email);

  // --- Cek duplikat email SEBELUM hashing & insert ---
  // Dicek manual dulu di sini (mirip pola cek slug unik di POST /api/products)
  // supaya pesan errornya jelas/ramah DAN supaya kita tidak buang waktu
  // nge-hash password (operasi yang sengaja lambat, lihat lib/password.js)
  // untuk request yang toh akan ditolak.
  const existing = findUserByEmail(db, normalizedEmail);
  if (existing) {
    return res.status(409).json({ status: 'error', message: 'Email sudah terdaftar' });
  }

  try {
    let passwordHash;
    try {
      passwordHash = await hashPassword(password);
    } catch (hashErr) {
      // hashPassword() melempar Error kalau password >72 byte (pesan menyebut
      // jumlah byte), atau TypeError kalau bukan string (seharusnya sudah
      // ditangkap validasi di atas, tapi jaga-jaga). Untuk kasus >72 byte,
      // ini SEBENARNYA kesalahan INPUT USER (password kepanjangan), bukan
      // kesalahan server - jadi dibalas 400 informatif, BUKAN 500 generik.
      // Deteksi ini TANPA menduplikasi Buffer.byteLength check dari
      // lib/password.js - cukup baca pesan errornya.
      if (hashErr.message && hashErr.message.includes('byte')) {
        return res.status(400).json({ status: 'error', message: 'Password terlalu panjang. Maksimal 72 byte.' });
      }
      throw hashErr; // error tak terduga lain -> jatuh ke catch luar -> 500
    }

    // --- Parameterized INSERT (WAJIB, anti SQL injection) ---
    // Sama seperti INSERT di POST /api/products: placeholder @email/
    // @password_hash, nilainya dikirim terpisah lewat object di `.run({...})`.
    const insert = db.prepare('INSERT INTO users (email, password_hash) VALUES (@email, @password_hash)');
    const info = insert.run({ email: normalizedEmail, password_hash: passwordHash });

    // Response SENGAJA hanya berisi id & email - TIDAK PERNAH password atau
    // password_hash, walaupun keduanya "ada" di memori/database saat ini.
    // Membocorkan hash sekalipun (bukan plaintext) tetap berisiko (hash bisa
    // jadi target brute-force offline kalau bocor).
    res.status(201).json({
      status: 'success',
      message: 'Registrasi berhasil',
      user: { id: info.lastInsertRowid, email: normalizedEmail },
    });
  } catch (err) {
    // Jaga-jaga race condition: dua request register dengan email sama nyaris
    // bersamaan bisa lolos cek `existing` di atas tapi bentrok saat INSERT
    // benar-benar dijalankan - constraint UNIQUE di kolom email (db/database.js)
    // jadi garis pertahanan terakhir.
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ status: 'error', message: 'Email sudah terdaftar' });
    }

    console.error('[POST /api/auth/register] Gagal registrasi:', err);
    res.status(500).json({ status: 'error', message: 'Terjadi kesalahan pada server' });
  }
});

// --- Route Phase 3C-2: login (verifikasi kredensial) ---
// Bedanya dengan register di atas: route ini TIDAK menulis apa pun ke
// database, cuma MEMBACA lalu membandingkan password yang diketik user
// dengan hash yang tersimpan. Validasi input di sini SENGAJA lebih minimal
// dibanding register (cuma cek "ada isinya", bukan format email/panjang
// password) - karena tujuannya beda: register memastikan DATA BARU yang
// masuk berkualitas baik, login cuma perlu tahu "ada dua field untuk
// dicocokkan atau tidak".
//
// TIDAK ADA token/session/JWT yang dibuat di sini - fase ini cuma
// membuktikan kredensial valid atau tidak (di luar scope Phase 3C-2).
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};

  const errors = [];
  if (email === undefined || email === null || typeof email !== 'string' || email.trim().length === 0) {
    errors.push('email wajib diisi');
  }
  if (password === undefined || password === null || typeof password !== 'string' || password.length === 0) {
    errors.push('password wajib diisi');
  }

  if (errors.length > 0) {
    // 400, BUKAN 401 - ini request yang CACAT (field kosong/tidak ada sama
    // sekali), beda kelas masalah dari 401 (field-nya ADA tapi kredensialnya
    // salah). Klien perlu tahu beda ini supaya bisa membedakan "form belum
    // diisi" vs "email/password yang diisi salah".
    return res.status(400).json({ status: 'error', message: 'Validasi gagal', details: errors });
  }

  const normalizedEmail = normalizeEmail(email);

  try {
    const user = findUserByEmail(db, normalizedEmail);

    let isValid;
    try {
      if (user) {
        isValid = await verifyPassword(password, user.password_hash);
      } else {
        // --- Anti-enumeration: tetap jalankan bcrypt.compare walau user tidak ada ---
        // Kalau baris ini di-skip (langsung lompat ke 401 saat user tidak
        // ditemukan), respons untuk "email tidak terdaftar" akan konsisten
        // lebih CEPAT dibanding "email terdaftar tapi password salah" (yang
        // menunggu bcrypt.compare selesai, operasi yang sengaja lambat).
        // Selisih waktu itu bisa dipakai penyerang untuk menebak email mana
        // saja yang terdaftar tanpa perlu tahu passwordnya - walau tidak
        // pernah dibalas ke client (dua-duanya tetap 401 sama persis di bawah).
        // Hasil verifyPassword() di sini PASTI false (DUMMY_HASH_FOR_TIMING_SAFETY
        // bukan hash dari password apa pun), tapi bcrypt.compare tetap harus
        // benar-benar DIJALANKAN, bukan di-skip.
        isValid = await verifyPassword(password, DUMMY_HASH_FOR_TIMING_SAFETY);
      }
    } catch (verifyErr) {
      // password >72 byte (atau tipe lain yang lolos validasi awal) tidak
      // mungkin cocok dengan hash manapun - hashPassword() tidak pernah
      // menghasilkan hash dari password sepanjang itu saat register. Jadi
      // ini diperlakukan sama seperti kredensial salah biasa (401 generik
      // lewat pengecekan `if (!user || !isValid)` di bawah), BUKAN error
      // server (500) - dan pesannya TIDAK dibedakan dari "password salah"
      // biasa, supaya tidak membocorkan informasi baru ke client soal
      // alasan gagalnya (konsisten dengan prinsip anti-enumeration di atas).
      isValid = false;
    }

    if (!user || !isValid) {
      // Pesan generik yang SAMA PERSIS untuk "email tidak ada" maupun "email
      // ada tapi password salah" - kalau dibedakan (misal "email tidak
      // ditemukan" vs "password salah"), penyerang bisa memakai pesan error
      // itu sendiri untuk enumerasi email mana yang terdaftar.
      return res.status(401).json({ status: 'error', message: 'Email atau password salah' });
    }

    // --- Phase 3C-3: set cookie session, SETELAH kredensial terbukti valid ---
    // sign(user.id) menghasilkan nilai `${id}.${hmacHex}` (lihat lib/session.js)
    // - bukti bertanda tangan bahwa "id ini memang milik user yang baru saja
    // berhasil login", bukan cuma id polos yang bisa dikarang bebas oleh client.
    const signedValue = sign(user.id);

    // res.cookie(nama, nilai, opsi) menambahkan header `Set-Cookie` ke
    // response - browser yang menerima ini otomatis MENYIMPAN cookie-nya, dan
    // akan otomatis MENGIRIM BALIK cookie ini di setiap request berikutnya ke
    // origin yang sama (selama belum expired/dihapus), tanpa frontend perlu
    // menyimpannya manual di localStorage dsb.
    //
    // - httpOnly: true -> cookie ini TIDAK BISA diakses lewat JavaScript sisi
    //   browser (document.cookie tidak akan menampilkannya). Ini pertahanan
    //   terhadap serangan XSS: walau ada script asing berhasil disisipkan ke
    //   halaman frontend, script itu tetap tidak bisa MEMBACA/MENCURI nilai
    //   cookie session ini.
    // - sameSite: 'lax' -> cookie ini tidak ikut terkirim pada request lintas
    //   situs yang dipicu situs LAIN (misal form/link dari situs asing yang
    //   mengarah ke API kita) kecuali navigasi top-level biasa (klik link) -
    //   pertahanan dasar terhadap CSRF, sambil tetap cukup longgar untuk
    //   pemakaian normal (fetch dari frontend kita sendiri tetap terkirim).
    // - secure: process.env.NODE_ENV === 'production' -> ikut environment,
    //   TIDAK hardcode lagi. Di localhost dev (NODE_ENV bukan 'production'),
    //   koneksinya HTTP biasa (bukan HTTPS) - kalau secure dipaksa `true` di
    //   sini, browser akan MENOLAK MENGIRIM cookie ini sama sekali lewat HTTP
    //   (secure cookie cuma pernah dikirim lewat HTTPS), yang berarti login
    //   di dev akan "berhasil" tapi requireAuth tidak akan pernah melihat
    //   cookie-nya. Sebaliknya, kalau nilainya hardcode `false` SELAMANYA
    //   (seperti sebelum fix ini), begitu server ini betulan di-deploy di
    //   belakang HTTPS, cookie session tetap akan diam-diam ikut terkirim
    //   walau suatu saat ada koneksi HTTP nyasar/accidental (misal downgrade
    //   attack) - environment inilah yang seharusnya menentukan, bukan angka
    //   tetap yang gampang lupa diganti manual saat deploy.
    // - maxAge: MAX_AGE_MS (lib/session.js) -> cookie kadaluarsa otomatis 24
    //   jam (dalam milidetik) sejak di-set - setelah itu browser sendiri yang
    //   membuang cookie-nya. Dipakai dari konstanta yang sama dengan yang
    //   ditegakkan verify() di lib/session.js (bukan angka literal terpisah
    //   yang ditulis ulang di sini) supaya "browser buang cookie" dan "server
    //   menolak token" selalu sepakat soal durasi 24 jam yang sama persis.
    res.cookie(COOKIE_NAME, signedValue, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: MAX_AGE_MS,
    });

    res.status(200).json({
      status: 'success',
      message: 'Login berhasil',
      user: { id: user.id, email: user.email },
      // Bentuk JSON response ini SENGAJA TIDAK BERUBAH sama sekali dari
      // sebelum Phase 3C-3 - satu-satunya hal baru di endpoint ini adalah
      // SIDE EFFECT `Set-Cookie` di atas (di luar body JSON), bukan field
      // token/session baru yang ditaruh di body. Cookie memang cara standar
      // browser menyimpan & mengirim ulang bukti login, jadi tidak perlu
      // (dan tidak sebaiknya) diduplikasi lagi jadi field di body JSON.
    });
  } catch (err) {
    console.error('[POST /api/auth/login] Gagal login:', err);
    res.status(500).json({ status: 'error', message: 'Terjadi kesalahan pada server' });
  }
});

// --- Route Phase 3C-3: logout (mengakhiri sesi) ---
// Pasangan dari POST /api/auth/login di atas - tanpa route ini, tidak ada
// cara bagi user untuk MENGAKHIRI sesi login-nya sendiri secara eksplisit
// (misal di komputer bersama/publik, user perlu bisa memastikan sesinya
// benar-benar berakhir, bukan cuma menutup tab browser dan berharap cookie-nya
// hilang sendiri - cookie yang di-set login tetap tersimpan sampai maxAge-nya
// habis, 24 jam, kalau tidak dihapus manual lewat endpoint ini).
//
// Tidak butuh request body sama sekali - satu-satunya "target" operasi ini
// adalah cookie session milik browser yang memanggilnya sendiri, tidak
// pernah ada userId dkk yang perlu dikirim dari client.
//
// --- requireAuth dipasang di sini (perbaikan review keamanan) ---
// Sebelumnya route ini TIDAK punya middleware apa pun - beda sendiri dari
// SEMUA route state-changing lain di fase ini (POST/PUT/DELETE /api/products
// semuanya sudah wajib requireAuth). Akibatnya logout tidak bisa membedakan
// "memang lagi login, sekarang logout" dari "sudah tidak login/tidak pernah
// login sama sekali, tapi tetap dibalas 200 seolah berhasil". Dengan
// requireAuth di sini, memanggil endpoint ini tanpa sesi yang valid akan
// ditolak 401 (semantik yang lebih benar) - perilaku SETELAH lolos requireAuth
// tetap SAMA PERSIS seperti sebelumnya (cuma clearCookie + pesan sukses).
app.post('/api/auth/logout', requireAuth, (req, res) => {
  // --- clearCookie WAJIB diberi opsi yang sama seperti saat cookie di-set ---
  // Sebelumnya dipanggil tanpa opsi sama sekali (`res.clearCookie(COOKIE_NAME)`)
  // - sebagian browser cuma mau benar-benar menghapus sebuah cookie kalau
  // atribut (httpOnly, sameSite, secure) pada perintah penghapusannya COCOK
  // dengan atribut saat cookie itu di-set (lihat res.cookie(...) di POST
  // /api/auth/login). `maxAge` SENGAJA tidak disertakan di sini - tidak
  // relevan untuk penghapusan (clearCookie sendiri yang mengatur waktu
  // kadaluarsa ke masa lalu).
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });
  res.status(200).json({ status: 'success', message: 'Logout berhasil' });
});

// --- 404 handler ---
// Jalan kalau tidak ada route di atas yang cocok dengan request-nya (baik
// route API seperti GET /api/nonexistent atau GET /api/products/unknown/
// endpoint, MAUPUN route non-API sembarangan seperti GET /apa-saja). Sengaja
// TIDAK dibedakan "API vs bukan API" di sini - route non-API yang memang ada
// (/, /menu, /about, /api/health) sudah didefinisikan lebih dulu di atas dan
// tidak pernah sampai ke handler ini; yang sampai ke sini pasti benar-benar
// tidak dikenal, jadi format JSON konsisten ini aman dipakai untuk semuanya
// (Phase 3B-5: sebelumnya `{ error: 'Not Found' }`, sekarang diseragamkan
// dengan format error di seluruh endpoint /api/products).
app.use((req, res) => {
  res.status(404).json({ status: 'error', message: 'Route tidak ditemukan' });
});

// --- Error handler ---
// Jalan kalau ada middleware/route yang melempar error (lewat `next(err)`
// atau exception - termasuk exception SINKRON, yang di Express 5 otomatis
// diteruskan ke sini tanpa perlu try/catch manual di setiap route). Express
// mengenali middleware ini SEBAGAI error handler karena punya 4 parameter
// (err, req, res, next) - bukan karena namanya atau urutan definisinya.
app.use((err, req, res, next) => {
  // --- Phase 3B-5: tangani malformed JSON body secara spesifik ---
  // express.json() (dipasang di baris atas) memakai body-parser di baliknya.
  // Kalau client mengirim body yang MENGAKU Content-Type: application/json
  // tapi isinya bukan JSON valid (misal `{"name":"Nasi Goreng",` - koma
  // menggantung tanpa penutup), body-parser melempar SyntaxError dengan ciri
  // khas: `err.type === 'entity.parse.failed'` (dan `err.status === 400`).
  // Error ini otomatis lompat ke sini (skip semua route/404 handler di atas)
  // karena dilempar dari MIDDLEWARE (express.json()), bukan dari dalam route.
  //
  // Sebelum diperbaiki, handler ini SELALU membalas 500 - padahal ini murni
  // kesalahan CLIENT (body yang dikirim rusak), bukan kesalahan server. Kalau
  // dibiarkan, client jadi salah paham "server error" padahal yang perlu
  // diperbaiki adalah JSON yang dikirimnya. Makanya di sini dibedakan jadi
  // 400, konsisten dengan aturan: 400 = request/input tidak valid.
  if (err.type === 'entity.parse.failed' && err.status === 400) {
    console.error('[JSON parse error]', err.message);
    return res.status(400).json({ status: 'error', message: 'Body request bukan JSON yang valid' });
  }

  // Error lain yang tak terduga (bukan malformed JSON, bukan error yang
  // sudah ditangani try/catch di masing-masing route): tetap JANGAN kirim
  // err.message/err.stack ke client (bisa membocorkan detail internal).
  // Log lengkap ke console server, client cukup dapat pesan generik + 500.
  console.error(err);
  res.status(500).json({ status: 'error', message: 'Internal Server Error' });
});

app.listen(PORT, () => {
  console.log(`Server jalan di http://localhost:${PORT}`);
});
