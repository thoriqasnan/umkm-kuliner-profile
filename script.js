// ==========================================================
// 1. HAMBURGER MENU (NAVBAR MOBILE)
// ==========================================================
// Logika: setiap kali tombol hamburger diklik, kita "toggle" (nyala/matikan)
// class "active" pada elemen menu (ul) dan pada tombol hamburger itu sendiri.
// - class "active" di nav-menu diatur di CSS untuk menampilkan menu (lihat style.css bagian responsive)
// - class "active" di hamburger diatur di CSS untuk mengubah ikon jadi bentuk silang (X)
const hamburger = document.getElementById("hamburger");
const navMenu = document.getElementById("navMenu");

hamburger.addEventListener("click", () => {
  hamburger.classList.toggle("active");
  navMenu.classList.toggle("active");
});

// Supaya menu otomatis tertutup setelah user klik salah satu link menu di mobile
// (kalau tidak ditutup manual, menu akan tetap terbuka menutupi konten di bawahnya)
const navLinks = document.querySelectorAll(".nav-link");
navLinks.forEach((link) => {
  link.addEventListener("click", () => {
    hamburger.classList.remove("active");
    navMenu.classList.remove("active");
  });
});

// ==========================================================
// 2. FILTER KATEGORI MENU/PRODUK
// ==========================================================
// Logika filter:
// 1. Ambil semua tombol filter (Semua, Makanan, Minuman, Snack)
// 2. Ambil semua card menu yang ada di grid
// 3. Saat sebuah tombol diklik:
//    a. Tandai tombol itu sebagai "active" (dan lepas status active dari tombol lain)
//    b. Baca kategori yang diminta lewat atribut data-filter, misal "makanan"
//    c. Cek setiap card: bandingkan atribut data-category card dengan kategori yang diminta.
//       Jika filter = "semua" ATAU kategori cocok -> tampilkan card.
//       Jika tidak cocok -> sembunyikan card dengan menambahkan class "hide".
const filterButtons = document.querySelectorAll(".filter-btn");
const menuCards = document.querySelectorAll(".menu-card");

filterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    // (a) pindahkan status "active" ke tombol yang baru diklik
    filterButtons.forEach((btn) => btn.classList.remove("active"));
    button.classList.add("active");

    // (b) kategori yang dipilih user, contoh: "makanan" / "minuman" / "snack" / "semua"
    const selectedCategory = button.getAttribute("data-filter");

    // (c) tampilkan/sembunyikan tiap card sesuai kategori
    menuCards.forEach((card) => {
      const cardCategory = card.getAttribute("data-category");
      const shouldShow = selectedCategory === "semua" || cardCategory === selectedCategory;

      card.classList.toggle("hide", !shouldShow);
    });
  });
});

// ==========================================================
// 3. CAROUSEL / SLIDER TESTIMONI
// ==========================================================
// Cara kerja carousel ini:
// - Semua slide (.testimoni-card) berbaris sejajar horizontal di dalam .carousel-track
//   (diatur lewat CSS "display: flex")
// - Untuk menampilkan slide ke-N, kita geser seluruh track ke kiri sejauh N * 100%
//   menggunakan CSS transform: translateX(-N * 100%)
// - currentSlide menyimpan index slide yang sedang tampil (mulai dari 0)
const track = document.getElementById("carouselTrack");
const slides = document.querySelectorAll(".testimoni-card");
const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");
const dotsContainer = document.getElementById("carouselDots");

let currentSlide = 0;
const totalSlides = slides.length;

// Buat titik indikator (dot) secara otomatis, jumlahnya sesuai jumlah slide.
// Dibuat lewat JS (bukan ditulis manual di HTML) supaya jumlah dot selalu
// sinkron dengan jumlah slide, walau nanti testimoni ditambah/dikurangi.
slides.forEach((_, index) => {
  const dot = document.createElement("button");
  dot.classList.add("dot");
  if (index === 0) dot.classList.add("active");

  // Klik dot -> langsung lompat ke slide sesuai index dot tersebut
  dot.addEventListener("click", () => goToSlide(index));

  dotsContainer.appendChild(dot);
});

const dots = document.querySelectorAll(".dot");

// Fungsi utama: pindah ke slide dengan index tertentu
function goToSlide(index) {
  currentSlide = index;

  // Geser track: setiap slide lebarnya 100% dari viewport carousel,
  // jadi untuk menampilkan slide ke-2 (index 1) kita geser -100%, dst.
  track.style.transform = `translateX(-${currentSlide * 100}%)`;

  // Update tampilan dot: hanya dot yang sesuai slide aktif yang diberi class "active"
  dots.forEach((dot, i) => dot.classList.toggle("active", i === currentSlide));
}

// Tombol "next": index bertambah 1, tapi kalau sudah di slide terakhir,
// kembali lagi ke slide pertama (index 0). Trik ini pakai operator modulo (%)
// supaya tidak perlu if-else manual: (currentSlide + 1) % totalSlides
nextBtn.addEventListener("click", () => {
  goToSlide((currentSlide + 1) % totalSlides);
});

// Tombol "prev": index berkurang 1. Ditambah totalSlides dulu sebelum modulo
// supaya hasilnya tidak jadi negatif saat mundur dari slide pertama (index 0).
prevBtn.addEventListener("click", () => {
  goToSlide((currentSlide - 1 + totalSlides) % totalSlides);
});

// Auto-slide: carousel otomatis geser ke slide berikutnya setiap 5 detik,
// supaya testimoni tetap bergerak walau user tidak berinteraksi.
let autoSlideInterval = setInterval(() => {
  goToSlide((currentSlide + 1) % totalSlides);
}, 5000);

// Saat mouse berada di atas carousel, hentikan auto-slide dulu (supaya user
// tidak terganggu saat sedang membaca testimoni), lalu lanjutkan lagi saat
// mouse keluar dari area carousel.
const carousel = document.querySelector(".carousel");
carousel.addEventListener("mouseenter", () => clearInterval(autoSlideInterval));
carousel.addEventListener("mouseleave", () => {
  autoSlideInterval = setInterval(() => {
    goToSlide((currentSlide + 1) % totalSlides);
  }, 5000);
});

// ==========================================================
// 4. TAHUN OTOMATIS DI FOOTER
// ==========================================================
// Supaya tulisan copyright di footer tidak perlu diedit manual tiap tahun baru.
document.getElementById("year").textContent = new Date().getFullYear();

// ==========================================================
// 5. GANTI BAHASA (ID / EN)
// ==========================================================
// Semua teks yang bisa diterjemahkan diberi atribut data-i18n="key" di HTML.
// Dictionary di bawah memetakan key itu ke teks Indonesia & Inggris.
// innerHTML dipakai (bukan textContent) supaya tag seperti <br> di hero.title tetap bekerja;
// aman karena semua isi teks statis ditulis sendiri di sini, bukan input dari user.
const translations = {
  id: {
    "nav.beranda": "Beranda",
    "nav.tentang": "Tentang",
    "nav.menu": "Menu/Produk",
    "nav.testimoni": "Testimoni",
    "nav.kontak": "Kontak",

    "hero.eyebrow": "Warung Kuliner Rumahan",
    "hero.title": "Cita Rasa Rumahan, <br>Kualitas Istimewa",
    "hero.desc": "Sari Rasa menghadirkan makanan dan minuman rumahan favorit keluarga, dibuat dari bahan segar setiap hari dengan resep turun-temurun.",
    "hero.cta": "Pesan Sekarang",

    "tentang.label": "Tentang Kami",
    "tentang.title": "Berawal dari Dapur Rumahan",
    "tentang.p1": "Sari Rasa berdiri sejak tahun 2015, dimulai dari dapur rumahan kecil yang melayani pesanan tetangga sekitar. Berkat rasa yang konsisten dan bahan-bahan pilihan, kini Sari Rasa menjadi warung favorit warga sekitar untuk menikmati makanan dan minuman rumahan sehari-hari.",
    "tentang.p2": "Kami percaya bahwa makanan enak tidak harus mahal. Setiap menu dimasak dengan resep keluarga yang dijaga kualitasnya dari waktu ke waktu.",

    "menu.label": "Menu Kami",
    "menu.title": "Pilihan Favorit Pelanggan",
    "filter.semua": "Semua",
    "filter.makanan": "Makanan",
    "filter.minuman": "Minuman",
    "filter.snack": "Snack",

    "product.nasigoreng.name": "Nasi Goreng Spesial",
    "product.nasigoreng.desc": "Nasi goreng dengan telur, ayam suwir, dan acar segar.",
    "product.ayamgeprek.name": "Ayam Geprek Sambal Matah",
    "product.ayamgeprek.desc": "Ayam crispy disiram sambal matah khas dengan tingkat kepedasan pilihan.",
    "product.sotoayam.name": "Soto Ayam Kampung",
    "product.sotoayam.desc": "Kuah bening gurih dengan suwiran ayam kampung dan pelengkap lengkap.",
    "product.mieayam.name": "Mie Ayam Bakso",
    "product.mieayam.desc": "Mie ayam dengan topping bakso sapi dan pangsit renyah.",
    "product.esteh.name": "Es Teh Manis",
    "product.esteh.desc": "Teh manis segar dengan es batu, pas untuk menemani makan siang.",
    "product.esjeruk.name": "Es Jeruk Peras",
    "product.esjeruk.desc": "Jeruk peras asli tanpa pemanis buatan, menyegarkan.",
    "product.kopisusu.name": "Kopi Susu Gula Aren",
    "product.kopisusu.desc": "Kopi susu dengan manis alami dari gula aren pilihan.",
    "product.eskelapa.name": "Es Kelapa Muda",
    "product.eskelapa.desc": "Kelapa muda asli dengan sedikit sirup gula merah.",
    "product.pisanggoreng.name": "Pisang Goreng Crispy",
    "product.pisanggoreng.desc": "Pisang goreng renyah di luar, lembut di dalam. Isi 5 pcs.",
    "product.risoles.name": "Risoles Mayo",
    "product.risoles.desc": "Risoles isi sayuran dan mayo, cocok untuk camilan sore.",
    "product.tahuisi.name": "Tahu Isi",
    "product.tahuisi.desc": "Tahu isi sayuran, digoreng renyah, disajikan dengan cabai rawit.",

    "keunggulan.label": "Keunggulan Kami",
    "keunggulan.title": "Kenapa Pilih Sari Rasa?",
    "keunggulan.bahan.title": "Bahan Segar",
    "keunggulan.bahan.desc": "Belanja bahan baku setiap pagi agar rasa dan kualitas terjaga.",
    "keunggulan.resep.title": "Resep Rumahan",
    "keunggulan.resep.desc": "Diolah dengan resep keluarga yang sudah teruji rasanya sejak 2015.",
    "keunggulan.harga.title": "Harga Terjangkau",
    "keunggulan.harga.desc": "Harga sahabat kantong tanpa mengurangi porsi dan kualitas rasa.",
    "keunggulan.delivery.title": "Bisa Delivery",
    "keunggulan.delivery.desc": "Pesan lewat WhatsApp, kami antar langsung ke lokasi kamu.",

    "testimoni.label": "Testimoni",
    "testimoni.title": "Kata Pelanggan Kami",
    "testimoni1.quote": "\"Nasi gorengnya juara, rasanya pas banget kaya masakan rumah! Jadi langganan tiap minggu.\"",
    "testimoni2.quote": "\"Kopi susu gula arennya bikin nagih, harganya juga ramah kantong. Recommended!\"",
    "testimoni3.quote": "\"Pelayanan ramah dan pesanan selalu cepat sampai. Ayam gepreknya pedasnya pas.\"",
    "testimoni4.quote": "\"Tempatnya bersih, menunya variatif, dan yang penting rasanya konsisten enak.\"",

    "kontak.label": "Kontak",
    "kontak.title": "Hubungi & Kunjungi Kami",
    "kontak.alamat": "Alamat",
    "kontak.jam": "Jam Buka",
    "kontak.jam.value": "Setiap Hari, 08.00 - 21.00 WIB",

    "footer.copyright": "Seluruh hak cipta dilindungi.",
  },
  en: {
    "nav.beranda": "Home",
    "nav.tentang": "About",
    "nav.menu": "Menu",
    "nav.testimoni": "Testimonials",
    "nav.kontak": "Contact",

    "hero.eyebrow": "Home-Style Culinary Shop",
    "hero.title": "Homemade Flavor, <br>Special Quality",
    "hero.desc": "Sari Rasa brings family-favorite home-style food and drinks, made fresh daily using recipes passed down through generations.",
    "hero.cta": "Order Now",

    "tentang.label": "About Us",
    "tentang.title": "Started From a Home Kitchen",
    "tentang.p1": "Sari Rasa was founded in 2015, starting from a small home kitchen serving orders for neighbors nearby. Thanks to its consistent taste and quality ingredients, Sari Rasa has become a local favorite for everyday home-style food and drinks.",
    "tentang.p2": "We believe good food doesn't have to be expensive. Every dish is cooked with a family recipe whose quality has been kept consistent over time.",

    "menu.label": "Our Menu",
    "menu.title": "Customer Favorites",
    "filter.semua": "All",
    "filter.makanan": "Food",
    "filter.minuman": "Drinks",
    "filter.snack": "Snacks",

    "product.nasigoreng.name": "Special Fried Rice",
    "product.nasigoreng.desc": "Fried rice with egg, shredded chicken, and fresh pickles.",
    "product.ayamgeprek.name": "Smashed Fried Chicken with Sambal Matah",
    "product.ayamgeprek.desc": "Crispy chicken topped with signature sambal matah, spice level of your choice.",
    "product.sotoayam.name": "Free-Range Chicken Soto",
    "product.sotoayam.desc": "Clear savory broth with shredded free-range chicken and full garnish.",
    "product.mieayam.name": "Chicken Noodles with Meatballs",
    "product.mieayam.desc": "Chicken noodles topped with beef meatballs and crispy dumplings.",
    "product.esteh.name": "Sweet Iced Tea",
    "product.esteh.desc": "Refreshing sweet tea with ice, perfect alongside lunch.",
    "product.esjeruk.name": "Fresh Squeezed Orange Juice",
    "product.esjeruk.desc": "Genuine squeezed orange juice with no artificial sweeteners, refreshing.",
    "product.kopisusu.name": "Palm Sugar Milk Coffee",
    "product.kopisusu.desc": "Milk coffee naturally sweetened with quality palm sugar.",
    "product.eskelapa.name": "Young Coconut Ice",
    "product.eskelapa.desc": "Fresh young coconut with a touch of palm sugar syrup.",
    "product.pisanggoreng.name": "Crispy Fried Banana",
    "product.pisanggoreng.desc": "Crispy on the outside, soft on the inside. 5 pieces per order.",
    "product.risoles.name": "Mayo Risoles",
    "product.risoles.desc": "Risoles filled with vegetables and mayo, perfect for an afternoon snack.",
    "product.tahuisi.name": "Stuffed Tofu",
    "product.tahuisi.desc": "Vegetable-stuffed tofu, fried crispy, served with bird's eye chilies.",

    "keunggulan.label": "Our Advantages",
    "keunggulan.title": "Why Choose Sari Rasa?",
    "keunggulan.bahan.title": "Fresh Ingredients",
    "keunggulan.bahan.desc": "We shop for ingredients every morning to keep the taste and quality on point.",
    "keunggulan.resep.title": "Homemade Recipe",
    "keunggulan.resep.desc": "Cooked with a family recipe proven delicious since 2015.",
    "keunggulan.harga.title": "Affordable Price",
    "keunggulan.harga.desc": "Budget-friendly prices without cutting portion size or taste quality.",
    "keunggulan.delivery.title": "Delivery Available",
    "keunggulan.delivery.desc": "Order via WhatsApp, we'll deliver straight to your location.",

    "testimoni.label": "Testimonials",
    "testimoni.title": "What Our Customers Say",
    "testimoni1.quote": "\"The fried rice is amazing, tastes just like home cooking! I've become a weekly regular.\"",
    "testimoni2.quote": "\"The palm sugar milk coffee is addictive, and the price is easy on the wallet. Highly recommended!\"",
    "testimoni3.quote": "\"Friendly service and orders always arrive fast. The smashed chicken's spice level is just right.\"",
    "testimoni4.quote": "\"The place is clean, the menu is varied, and most importantly the taste is consistently good.\"",

    "kontak.label": "Contact",
    "kontak.title": "Contact & Visit Us",
    "kontak.alamat": "Address",
    "kontak.jam": "Opening Hours",
    "kontak.jam.value": "Every Day, 08:00 AM - 09:00 PM (WIB)",

    "footer.copyright": "All rights reserved.",
  },
};

const langButtons = document.querySelectorAll(".lang-btn");
const i18nElements = document.querySelectorAll("[data-i18n]");

function applyLanguage(lang) {
  i18nElements.forEach((el) => {
    const key = el.getAttribute("data-i18n");
    const text = translations[lang][key];
    if (text !== undefined) el.innerHTML = text;
  });

  langButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.lang === lang));
  document.documentElement.lang = lang;
  localStorage.setItem("sari-rasa-lang", lang);
}

langButtons.forEach((btn) => {
  btn.addEventListener("click", () => applyLanguage(btn.dataset.lang));
});

// Bahasa terakhir yang dipilih customer disimpan di localStorage,
// jadi tetap konsisten walau halaman di-refresh atau dibuka lagi nanti.
applyLanguage(localStorage.getItem("sari-rasa-lang") || "id");
