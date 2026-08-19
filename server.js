// server.js — Backend UMKM Sari Rasa, sekarang pakai Express.
// Sebelumnya kita nulis routing manual pakai if/else di atas modul `http` bawaan Node.
// Sekarang kita pindah ke Express: library yang membungkus `http` supaya penulisan
// route, JSON, dan penanganan error jadi lebih singkat dan rapi.

const express = require('express');
const cors = require('cors');

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

// --- Route Phase 2B: daftar produk (masih data hardcoded, belum database) ---
// Diperluas dari 7 item generik menjadi PERSIS 11 produk yang sebelumnya
// ditulis statis di index.html, supaya frontend bisa render menu grid dari
// data ini lewat fetch() tanpa mengubah tampilan sama sekali.
//
// `slug` HARUS sama persis dengan key i18n di dictionary `translations` pada
// script.js (contoh: slug "nasigoreng" berpasangan dengan key
// "product.nasigoreng.name" / "product.nasigoreng.desc") - ini yang
// menghubungkan produk hasil fetch dengan sistem ganti bahasa ID/EN yang
// sudah ada, tanpa perlu duplikasi teks di backend.
//
// `image.srcset`/`image.sizes` sengaja null kalau produk itu tidak punya
// varian ukuran gambar (dulu juga tidak ditulis di HTML aslinya) - frontend
// akan skip atribut srcset/sizes kalau nilainya null.
app.get('/api/products', (req, res) => {
  const products = [
    {
      id: 1,
      slug: 'nasigoreng',
      name: 'Nasi Goreng Spesial',
      price: 20000,
      category: 'makanan',
      image: {
        src: 'images/nasi-goreng-spesial.jpg',
        srcset: null,
        sizes: null,
        alt: 'Nasi Goreng Spesial',
        width: 700,
        height: 467,
      },
    },
    {
      id: 2,
      slug: 'ayamgeprek',
      name: 'Ayam Geprek Sambal Matah',
      price: 22000,
      category: 'makanan',
      image: {
        src: 'images/ayam-geprek-sambal-matah.jpg',
        srcset: null,
        sizes: null,
        alt: 'Ayam Geprek Sambal Matah',
        width: 700,
        height: 467,
      },
    },
    {
      id: 3,
      slug: 'sotoayam',
      name: 'Soto Ayam Kampung',
      price: 20000,
      category: 'makanan',
      image: {
        src: 'images/soto-ayam-kampung.jpg',
        srcset: 'images/soto-ayam-kampung-480w.jpg 480w, images/soto-ayam-kampung.jpg 700w',
        sizes: '(max-width: 768px) 100vw, (max-width: 900px) 50vw, 360px',
        alt: 'Soto Ayam Kampung',
        width: 700,
        height: 467,
      },
    },
    {
      id: 4,
      slug: 'mieayam',
      name: 'Mie Ayam Bakso',
      price: 18000,
      category: 'makanan',
      image: {
        src: 'images/mie-ayam-bakso.jpg',
        srcset: 'images/mie-ayam-bakso-480w.jpg 480w, images/mie-ayam-bakso.jpg 559w',
        sizes: '(max-width: 768px) 100vw, (max-width: 900px) 50vw, 360px',
        alt: 'Mie Ayam Bakso',
        width: 700,
        height: 467,
      },
    },
    {
      id: 5,
      slug: 'esteh',
      name: 'Es Teh Manis',
      price: 5000,
      category: 'minuman',
      image: {
        src: 'images/es-teh-manis.jpg',
        srcset: 'images/es-teh-manis-480w.jpg 480w, images/es-teh-manis.jpg 700w',
        sizes: '(max-width: 768px) 100vw, (max-width: 900px) 50vw, 360px',
        alt: 'Es Teh Manis',
        width: 700,
        height: 467,
      },
    },
    {
      id: 6,
      slug: 'esjeruk',
      name: 'Es Jeruk Peras',
      price: 8000,
      category: 'minuman',
      image: {
        src: 'images/es-jeruk-peras.jpg',
        srcset: 'images/es-jeruk-peras-480w.jpg 480w, images/es-jeruk-peras.jpg 700w',
        sizes: '(max-width: 768px) 100vw, (max-width: 900px) 50vw, 360px',
        alt: 'Es Jeruk Peras',
        width: 700,
        height: 467,
      },
    },
    {
      id: 7,
      slug: 'kopisusu',
      name: 'Kopi Susu Gula Aren',
      price: 15000,
      category: 'minuman',
      image: {
        src: 'images/kopi-susu-gula-aren.jpg',
        srcset: 'images/kopi-susu-gula-aren-480w.jpg 480w, images/kopi-susu-gula-aren.jpg 700w',
        sizes: '(max-width: 768px) 100vw, (max-width: 900px) 50vw, 360px',
        alt: 'Kopi Susu Gula Aren',
        width: 700,
        height: 467,
      },
    },
    {
      id: 8,
      slug: 'eskelapa',
      name: 'Es Kelapa Muda',
      price: 12000,
      category: 'minuman',
      image: {
        src: 'images/es-kelapa-muda.jpg',
        srcset: 'images/es-kelapa-muda-480w.jpg 480w, images/es-kelapa-muda.jpg 700w',
        sizes: '(max-width: 768px) 100vw, (max-width: 900px) 50vw, 360px',
        alt: 'Es Kelapa Muda',
        width: 700,
        height: 467,
      },
    },
    {
      id: 9,
      slug: 'pisanggoreng',
      name: 'Pisang Goreng Crispy',
      price: 10000,
      category: 'snack',
      image: {
        src: 'images/pisang-goreng-crispy.jpg',
        srcset: 'images/pisang-goreng-crispy-480w.jpg 480w, images/pisang-goreng-crispy.jpg 524w',
        sizes: '(max-width: 768px) 100vw, (max-width: 900px) 50vw, 360px',
        alt: 'Pisang Goreng Crispy',
        width: 700,
        height: 467,
      },
    },
    {
      id: 10,
      slug: 'risoles',
      name: 'Risoles Mayo',
      price: 12000,
      category: 'snack',
      image: {
        src: 'images/risoles-mayo.jpg',
        srcset: 'images/risoles-mayo-480w.jpg 480w, images/risoles-mayo.jpg 700w',
        sizes: '(max-width: 768px) 100vw, (max-width: 900px) 50vw, 360px',
        alt: 'Risoles Mayo',
        width: 700,
        height: 467,
      },
    },
    {
      id: 11,
      slug: 'tahuisi',
      name: 'Tahu Isi',
      price: 8000,
      category: 'snack',
      image: {
        src: 'images/tahu-isi.jpg',
        srcset: 'images/tahu-isi-480w.jpg 480w, images/tahu-isi.jpg 525w',
        sizes: '(max-width: 768px) 100vw, (max-width: 900px) 50vw, 360px',
        alt: 'Tahu Isi',
        width: 700,
        height: 467,
      },
    },
  ];
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
