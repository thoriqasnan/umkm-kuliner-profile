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
app.put('/api/products/:id', (req, res) => {
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
app.delete('/api/products/:id', (req, res) => {
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
