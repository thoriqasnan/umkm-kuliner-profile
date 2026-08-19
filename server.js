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
