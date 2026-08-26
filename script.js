// ==========================================================
// 1. HAMBURGER MENU (NAVBAR MOBILE)
// ==========================================================
// Logika: setiap kali tombol hamburger diklik, kita "toggle" (nyala/matikan)
// class "active" pada elemen menu (ul) dan pada tombol hamburger itu sendiri.
// - class "active" di nav-menu diatur di CSS untuk menampilkan menu (lihat style.css bagian responsive)
// - class "active" di hamburger diatur di CSS untuk mengubah ikon jadi bentuk silang (X)
const hamburger = document.getElementById("hamburger");
const navMenu = document.getElementById("navMenu");
const navbarRight = document.querySelector(".navbar-right"); // pembungkus hamburger + nav-menu

// Ditulis sebagai fungsi berdiri sendiri karena dipakai di TIGA tempat yang
// harus selalu menutup menu dengan cara yang persis sama (class "active" di
// hamburger & nav-menu, dan aria-expanded): klik salah satu link menu, tekan
// Escape, dan klik di luar area navbar-right (lihat di bawah). Kalau logika
// ini ditulis ulang terpisah di tiap tempat, gampang lupa salah satu (misal
// lupa update aria-expanded di satu tempat tapi tidak di tempat lain).
function closeMobileMenu() {
  hamburger.classList.remove("active");
  navMenu.classList.remove("active");
  hamburger.setAttribute("aria-expanded", "false");
}

hamburger.addEventListener("click", () => {
  const isOpen = hamburger.classList.toggle("active");
  navMenu.classList.toggle("active");
  // aria-expanded memberitahu screen reader apakah menu sedang terbuka atau tertutup
  hamburger.setAttribute("aria-expanded", isOpen);
});

// Supaya menu otomatis tertutup setelah user klik salah satu link menu di mobile
// (kalau tidak ditutup manual, menu akan tetap terbuka menutupi konten di bawahnya)
const navLinks = document.querySelectorAll(".nav-link");
navLinks.forEach((link) => {
  link.addEventListener("click", () => {
    closeMobileMenu();
  });
});

// Tombol Escape menutup menu mobile kalau sedang terbuka - kebiasaan umum
// untuk elemen yang bisa dibuka/ditutup (mirip <dialog> panel keranjang yang
// otomatis dapat perilaku ini gratis dari browser; menu hamburger di sini
// bukan <dialog>, jadi perilakunya perlu ditulis manual).
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (!navMenu.classList.contains("active")) return;

  closeMobileMenu();
  hamburger.focus(); // kembalikan fokus ke tombol pemicu, supaya pengguna keyboard tidak "kehilangan" posisi
});

// Klik di mana pun DI LUAR area navbar-right (pembungkus tombol hamburger +
// menu) menutup menu kalau sedang terbuka - pola umum untuk dropdown/menu
// yang seharusnya tertutup begitu pengguna mengalihkan perhatian ke tempat
// lain di halaman.
//
// PENTING soal urutan event: listener ini didaftarkan SEKALI saja di sini
// (bukan didaftarkan ulang di dalam handler klik hamburger di atas setiap
// menu dibuka) - itu justru pola yang gampang bikin bug "menu langsung
// tertutup lagi begitu dibuka", karena listener yang didaftarkan di tengah
// proses klik masih bisa ikut kebagian giliran event klik yang sama lewat
// bubbling. Karena listener ini selalu aktif dari awal, satu-satunya
// penjagaan yang perlu adalah mengecek APAKAH klik terjadi di dalam
// navbar-right lewat contains(): klik pada tombol hamburger sendiri (baik
// yang MEMBUKA atau MENUTUP menu) selalu dianggap "di dalam" navbar-right,
// jadi baris di bawah tidak akan pernah menutup menu tepat saat baru dibuka.
document.addEventListener("click", (event) => {
  if (!navMenu.classList.contains("active")) return;
  if (navbarRight.contains(event.target)) return;

  closeMobileMenu();
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
// "let" (bukan "const") karena saat baris ini pertama kali jalan, kartu menu
// BELUM ada di DOM (masih menunggu fetch() ke backend selesai - lihat
// loadMenu() di bagian 3c). NodeList ini sengaja kosong dulu, lalu di-assign
// ULANG (query ulang ke DOM) di dalam loadMenu() begitu kartu-kartu hasil
// fetch selesai disisipkan. Semua kode di bawah yang memakai menuCards lewat
// closure (filter kategori, updateCartSummary, buildOrderMessage, dst) aman
// karena mereka membaca variabel ini SETIAP dipanggil, bukan menyimpan
// salinannya sendiri saat didaftarkan.
let menuCards = document.querySelectorAll(".menu-card");

filterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    // (a) pindahkan status "active" ke tombol yang baru diklik
    // aria-pressed memberitahu screen reader tombol filter mana yang sedang aktif
    filterButtons.forEach((btn) => {
      btn.classList.remove("active");
      btn.setAttribute("aria-pressed", "false");
    });
    button.classList.add("active");
    button.setAttribute("aria-pressed", "true");

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
// 3. KERANJANG PESANAN (CART)
// ==========================================================
// Prinsip utama: DOM tetap jadi satu-satunya "sumber kebenaran" (source of
// truth) untuk jumlah pesanan tiap menu, sama seperti filter kategori di atas
// yang membaca langsung dari atribut data-category tiap card, bukan dari
// array terpisah. Di sini, jumlah pesanan disimpan langsung di teks
// <span class="qty-value"> pada tiap card, dan total keranjang dihitung ulang
// dari situ setiap kali ada perubahan.
// Keuntungan pendekatan ini: filter kategori (yang hanya menyembunyikan card
// lewat class "hide" di CSS, bukan menghapusnya dari DOM) tidak akan pernah
// menghilangkan jumlah pesanan yang sudah diisi user, walau card-nya sedang
// disembunyikan dari layar. Cart tetap "ingat" karena datanya tetap ada di DOM.
const WHATSAPP_NUMBER = "6281325132360";

// Nomor WhatsApp yang sama juga ditulis manual di dua link statis di
// index.html (tombol "Pesan Sekarang" di hero, dan link di bagian kontak),
// karena keduanya bukan dibuat lewat JS seperti tombol checkout keranjang.
// Supaya WHATSAPP_NUMBER di atas benar-benar jadi SATU sumber kebenaran
// (bukan tiga tempat terpisah yang harus diingat-ingat), baris di bawah ini
// otomatis menimpa nomor di kedua link statis itu dengan nilai konstanta ini
// begitu halaman dimuat - jadi kalau nomor WhatsApp warung berubah, cukup
// ubah WHATSAPP_NUMBER satu kali di sini saja.
document.querySelectorAll('a[href*="wa.me/"]').forEach((link) => {
  link.href = link.href.replace(/(wa\.me\/)\d+/, `$1${WHATSAPP_NUMBER}`);
});

const cartCountEl = document.getElementById("cartCount");
const cartTotalEl = document.getElementById("cartTotal");
const cartHintEl = document.getElementById("cartHint");
const cartCheckoutBtn = document.getElementById("cartCheckoutBtn");
const cartStatus = document.getElementById("cartStatus");
const cartViewBtn = document.getElementById("cartViewBtn");
const cartPanel = document.getElementById("cartPanel");
const cartPanelCloseBtn = document.getElementById("cartPanelCloseBtn");
const cartPanelEmpty = document.getElementById("cartPanelEmpty");
const cartPanelList = document.getElementById("cartPanelList");

// Ubah angka biasa jadi format Rupiah ala Indonesia, misal 20000 -> "Rp 20.000".
// toLocaleString("id-ID") otomatis memberi titik pemisah ribuan, jadi hasilnya
// konsisten dengan harga yang sudah ditulis manual di tiap menu-card.
function formatRupiah(amount) {
  return "Rp " + amount.toLocaleString("id-ID");
}

// Dua fungsi kecil ini dipakai di banyak tempat (bar keranjang, panel detail,
// pesan WhatsApp) untuk baca qty & harga sebuah card. Ditulis sebagai fungsi
// terpisah (bukan ditulis ulang parseInt(...) berkali-kali di tiap tempat)
// supaya kalau ada perubahan cara membaca data ini nanti, cukup diubah di
// satu tempat saja - tidak perlu diingat-ingat harus ubah di banyak lokasi.
//
// Catatan soal data-price: harus berupa angka polos tanpa titik/koma
// (contoh benar: 20000, BUKAN "20.000") - parseInt akan berhenti di karakter
// pertama yang bukan angka, jadi "20.000" akan terbaca jadi 20 saja, bukan
// 20000. Kalau menambah menu baru, pastikan angka di data-price ini sama
// dengan harga yang ditulis di <span class="price"> pada card yang sama.
function getCardQty(card) {
  return parseInt(card.querySelector(".qty-value").textContent, 10) || 0;
}

function getCardPrice(card) {
  return parseInt(card.getAttribute("data-price"), 10) || 0;
}

// Hitung ulang total item & total harga dari SEMUA card (termasuk yang sedang
// disembunyikan filter), lalu perbarui tampilan bar keranjang di bawah layar.
// Dipanggil setiap kali user menekan tombol +/- di salah satu card.
function updateCartSummary() {
  let totalItems = 0;
  let totalPrice = 0;

  menuCards.forEach((card) => {
    const qty = getCardQty(card);
    const price = getCardPrice(card);
    totalItems += qty;
    totalPrice += qty * price;
  });

  cartCountEl.textContent = totalItems;
  cartTotalEl.textContent = formatRupiah(totalPrice);

  // Keranjang kosong -> tombol checkout dimatikan (disabled) supaya tidak
  // bisa mengirim pesanan kosong ke WhatsApp, dan pesan hint ditampilkan.
  const isEmpty = totalItems === 0;
  cartCheckoutBtn.disabled = isEmpty;
  cartHintEl.classList.toggle("hide", !isEmpty);

  // Umumkan perubahan ke pengguna screen reader lewat teks tersembunyi
  // (aria-live), memakai pola yang sama seperti status carousel di bawah.
  const isEnglish = document.documentElement.lang === "en";
  cartStatus.textContent = isEmpty
    ? isEnglish
      ? "Cart is empty"
      : "Keranjang masih kosong"
    : isEnglish
    ? `Cart: ${totalItems} item(s), total ${formatRupiah(totalPrice)}`
    : `Keranjang: ${totalItems} item, total ${formatRupiah(totalPrice)}`;
}

// Ubah qty pada SATU card tertentu. Ditulis sebagai fungsi berdiri sendiri
// (bukan ditutup di dalam forEach seperti sebelumnya) supaya bisa dipakai
// bersama oleh dua tempat: tombol +/- di grid menu utama, DAN tombol +/- di
// dalam panel detail pesanan (lihat bagian "3b" di bawah). Karena keduanya
// memanggil fungsi yang sama dan sama-sama mengubah .qty-value pada card
// aslinya, tidak ada dua salinan data qty yang bisa jadi tidak sinkron.
// Jumlah minimal adalah 0 (tidak bisa negatif); sengaja tidak diberi batas
// maksimal supaya tetap sederhana (MVP).
function changeCardQty(card, delta) {
  const qtyValueEl = card.querySelector(".qty-value");
  const currentQty = getCardQty(card);
  const nextQty = Math.max(0, currentQty + delta);
  qtyValueEl.textContent = nextQty;
  updateCartSummary();

  // Kalau panel detail pesanan sedang terbuka, render ulang isinya supaya
  // qty dan subtotal yang tampil di sana selalu sesuai kondisi terbaru -
  // baik perubahan yang datang dari grid menu maupun dari panel itu sendiri.
  if (cartPanel.open) renderCartPanel();
}

// Pasang tombol +/- di setiap card menu di grid utama.
// Dibungkus jadi fungsi (bukan langsung dijalankan di sini seperti versi
// sebelumnya), karena baris ini butuh kartu-kartu menu SUDAH ada fisik di
// DOM supaya querySelector(".qty-decrease"/".qty-increase") menemukan
// sesuatu. Sejak Phase 2B, kartu baru ada setelah fetch() ke backend
// selesai - jadi fungsi ini dipanggil dari dalam loadMenu() (bagian 3c),
// TEPAT SETELAH kartu-kartu hasil fetch selesai disisipkan ke #menuGrid,
// bukan lagi dijalankan di sini di top-level saat kartu belum ada.
function wireMenuCardQtyButtons() {
  menuCards.forEach((card) => {
    const decreaseBtn = card.querySelector(".qty-decrease");
    const increaseBtn = card.querySelector(".qty-increase");

    decreaseBtn.addEventListener("click", () => changeCardQty(card, -1));
    increaseBtn.addEventListener("click", () => changeCardQty(card, 1));
  });
}

// Susun pesan pesanan yang rapi untuk dikirim ke WhatsApp: nama item,
// jumlah, subtotal per baris, lalu grand total di baris terakhir.
function buildOrderMessage() {
  const isEnglish = document.documentElement.lang === "en";
  const lines = [];

  lines.push(isEnglish ? "Hi Sari Rasa, I would like to order:" : "Halo Sari Rasa, saya mau pesan:");
  lines.push("");

  let totalPrice = 0;
  let itemNumber = 0; // penomoran urut item yang benar-benar dipesan (qty > 0)
  menuCards.forEach((card) => {
    const qty = getCardQty(card);
    if (qty === 0) return; // lewati item yang tidak dipesan (jumlah masih 0)

    const price = getCardPrice(card);
    // Ambil nama produk langsung dari <h3> di card: karena applyLanguage()
    // sudah mengganti innerHTML-nya sesuai bahasa aktif, teks ini otomatis
    // ikut dalam bahasa yang sedang dipilih user (ID/EN) tanpa perlu kode tambahan.
    const name = card.querySelector("h3").textContent.trim();
    const subtotal = qty * price;
    totalPrice += subtotal;
    itemNumber += 1;

    lines.push(`${itemNumber}. ${name} x${qty} = ${formatRupiah(subtotal)}`);

    // Catatan per item (diisi lewat panel detail pesanan, lihat bagian "3b"
    // di bawah) TIDAK lagi ditempel di baris yang sama dengan produk -
    // sekarang ditaruh di baris-baris tersendiri tepat di bawahnya, supaya
    // penjual lebih mudah membacanya (baris produk vs baris catatan jelas
    // terpisah). Catatan sifatnya tetap opsional, jadi kalau kosong tidak
    // menambah baris apa pun.
    //
    // Textarea di panel mengizinkan Enter untuk baris baru, jadi satu
    // catatan bisa terdiri dari beberapa baris. Di-split per baris (\n),
    // masing-masing di-trim, lalu baris yang jadi kosong (misal karena
    // pelanggan cuma menekan Enter berkali-kali) dibuang - biar tidak ada
    // baris kosong nyempil di pesan WhatsApp.
    const note = (card.dataset.note || "").trim();
    if (note) {
      // Tanda bintang (*) dibuang dari catatan karena WhatsApp memakainya
      // sebagai penanda cetak tebal - kalau dibiarkan, tanda bintang yang
      // ditulis pelanggan bisa "bocor" mengubah bagian lain pesan (misalnya
      // baris *Total* di paling bawah) jadi ikut tercetak tebal atau tidak.
      const noteLines = note
        .split("\n")
        .map((l) => l.replace(/\*/g, "").trim())
        .filter((l) => l.length > 0);
      const label = isEnglish ? "Note" : "Catatan";
      if (noteLines.length === 1) {
        // Catatan satu baris: label dan isinya digabung di baris yang sama.
        lines.push(`${label}: ${noteLines[0]}`);
      } else {
        // Catatan lebih dari satu baris: label sendirian di barisnya,
        // lalu tiap baris catatan ditaruh di bawahnya tanpa label berulang.
        lines.push(`${label}:`);
        noteLines.forEach((noteLine) => lines.push(noteLine));
      }
    }

    lines.push(""); // baris kosong pemisah sebelum item berikutnya (atau sebelum Total)
  });

  lines.push(`*Total: Rp${totalPrice.toLocaleString("id-ID")}*`);

  return lines.join("\n");
}

// Klik tombol checkout -> buka WhatsApp di tab baru dengan pesan pesanan
// yang sudah disusun dan di-encode agar aman dipakai sebagai parameter URL.
cartCheckoutBtn.addEventListener("click", () => {
  // Pengecekan tambahan selain atribut "disabled" di HTML, untuk jaga-jaga
  // (misalnya kalau disabled sempat lepas lewat cara lain): jangan kirim
  // pesanan kosong ke WhatsApp.
  if (cartCheckoutBtn.disabled) return;

  const message = buildOrderMessage();
  const url = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
  // "noopener" mencegah tab baru punya akses balik ke halaman ini lewat
  // window.opener, sama seperti rel="noopener" pada link WhatsApp lain di HTML.
  window.open(url, "_blank", "noopener");
});

// ----------------------------------------------------------
// 3c. AMBIL DATA PRODUK DARI BACKEND (fetch) & RENDER MENU GRID
// ----------------------------------------------------------
// Alamat backend Express (lihat server.js) - sengaja ditulis eksplisit
// (bukan path relatif seperti "/api/products") karena frontend dan backend
// jalan di ORIGIN yang berbeda (frontend di :5500 lewat Live Server, backend
// di :3000), jadi fetch() perlu tahu persis ke mana harus mengirim request.
const API_BASE_URL = "http://localhost:3000";

// Bikin SATU elemen <div class="menu-card"> dari satu objek produk (hasil
// fetch dari /api/products). Strukturnya dibuat SAMA PERSIS seperti kartu
// statis yang dulu ditulis manual di index.html (class, atribut ARIA,
// data-i18n, dst) supaya style.css tetap apply tanpa perlu diubah sama
// sekali, dan supaya fitur lain (filter kategori baca data-category, cart
// baca data-price & .qty-value, i18n baca data-i18n) semuanya tetap jalan
// persis seperti sebelumnya - kartu ini "menyamar" jadi kartu statis di mata
// kode-kode itu.
function createMenuCardElement(product) {
  const card = document.createElement("div");
  card.className = "menu-card";
  card.dataset.category = product.category;
  card.dataset.price = product.price;
  // Dipakai tombol Edit/Hapus admin di bawah untuk tahu produk MANA yang
  // harus diubah/dihapus lewat API (lihat openProductDialog()/handleDeleteProduct()
  // di bagian 9 - AUTENTIKASI & ADMIN PRODUK).
  card.dataset.productId = product.id;

  const img = document.createElement("img");
  img.className = "card-photo";
  img.src = product.image.src;
  // srcset/sizes hanya dipasang kalau memang ada nilainya (beberapa produk
  // tidak punya varian ukuran gambar, sama seperti di HTML aslinya dulu).
  if (product.image.srcset) img.srcset = product.image.srcset;
  if (product.image.sizes) img.sizes = product.image.sizes;
  img.alt = product.image.alt;
  img.loading = "lazy";
  img.width = product.image.width;
  img.height = product.image.height;

  const body = document.createElement("div");
  body.className = "menu-card-body";

  const top = document.createElement("div");
  top.className = "menu-card-top";

  const h3 = document.createElement("h3");
  h3.setAttribute("data-i18n", `product.${product.slug}.name`);
  h3.textContent = product.name;

  const priceEl = document.createElement("span");
  priceEl.className = "price";
  priceEl.textContent = formatRupiah(product.price);

  top.append(h3, priceEl);

  // Sejak Phase 3E, deskripsi TIDAK LAGI pakai atribut data-i18n seperti
  // sebelumnya (bandingkan dengan <h3> nama produk di atas, yang masih
  // memakainya). WHY: deskripsi sekarang bisa datang dari database PER-PRODUK
  // (product.description.id/en), bukan cuma dari kamus terjemahan statis
  // global yang key-nya tetap - mekanisme data-i18n/applyLanguage() biasa
  // (baca teks dari translations[lang][key] pakai key yang sama untuk semua
  // pengunjung) tidak cukup lagi untuk elemen ini. Penggantian teks saat ganti
  // bahasa sekarang ditangani terpisah lewat updateProductDescriptions()
  // (lihat bagian 9a), yang dipanggil dari applyLanguage().
  const desc = document.createElement("p");
  desc.className = "menu-card-desc";
  desc.textContent = getProductDescriptionText(product, document.documentElement.lang);

  const controls = document.createElement("div");
  controls.className = "cart-controls";
  controls.setAttribute("role", "group");
  controls.setAttribute("data-i18n-aria", "cart.qtyGroup");
  controls.setAttribute("aria-label", "Jumlah pesanan");

  const decreaseBtn = document.createElement("button");
  decreaseBtn.type = "button";
  decreaseBtn.className = "qty-btn qty-decrease";
  decreaseBtn.setAttribute("data-i18n-aria", "cart.decrease");
  decreaseBtn.setAttribute("aria-label", "Kurangi jumlah");
  decreaseBtn.innerHTML = "&minus;";

  const qtyValue = document.createElement("span");
  qtyValue.className = "qty-value";
  qtyValue.setAttribute("aria-live", "polite");
  qtyValue.textContent = "0";

  const increaseBtn = document.createElement("button");
  increaseBtn.type = "button";
  increaseBtn.className = "qty-btn qty-increase";
  increaseBtn.setAttribute("data-i18n-aria", "cart.increase");
  increaseBtn.setAttribute("aria-label", "Tambah jumlah");
  increaseBtn.innerHTML = "+";

  controls.append(decreaseBtn, qtyValue, increaseBtn);
  body.append(top, desc, controls);

  // Tombol Edit/Hapus HANYA ditambahkan kalau pengunjung yang sedang login
  // adalah admin (lihat currentUser di bagian 9 - AUTENTIKASI & ADMIN
  // PRODUK). Ini cuma soal TAMPILAN - kalaupun seseorang memaksa memanggil
  // endpoint PUT/DELETE langsung tanpa tombol ini, backend (requireAdmin di
  // server.js) tetap akan menolaknya kalau dia bukan admin sungguhan.
  if (currentUser && currentUser.role === "admin") {
    const adminControls = document.createElement("div");
    adminControls.className = "menu-card-admin";

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "btn-admin-edit";
    editBtn.setAttribute("data-i18n", "admin.editBtn");
    editBtn.textContent = translations[document.documentElement.lang]["admin.editBtn"];
    editBtn.addEventListener("click", () => openProductDialog("edit", product.id));

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "btn-admin-delete";
    deleteBtn.setAttribute("data-i18n", "admin.deleteBtn");
    deleteBtn.textContent = translations[document.documentElement.lang]["admin.deleteBtn"];
    deleteBtn.addEventListener("click", () => handleDeleteProduct(product.id));

    adminControls.append(editBtn, deleteBtn);
    body.appendChild(adminControls);
  }

  card.append(img, body);
  return card;
}

// Ambil daftar produk dari backend, lalu render jadi kartu-kartu di
// #menuGrid. Dipanggil sekali saat halaman dimuat (lihat pemanggilan di
// bawah fungsi ini).
//
// Urutan penting di dalam try setelah render:
// 1. Query ulang ".menu-card" (sekarang sudah ADA di DOM) -> assign ulang ke
//    variabel "menuCards" yang dipakai fitur filter/cart/panel di atas.
// 2. wireMenuCardQtyButtons() -> pasang listener +/- ke kartu-kartu yang baru
//    saja dibuat (kartu lama tidak pernah punya listener ini sama sekali).
// 3. updateCartSummary() -> hitung ulang bar keranjang (sebelumnya dipanggil
//    langsung di top-level, sekarang dipindah ke sini karena harus menunggu
//    kartu ada dulu).
// 4. applyLanguage() -> isi teks nama/deskripsi produk sesuai bahasa aktif,
//    karena kartu baru dibuat dengan teks default Indonesia di atas.
async function loadMenu() {
  const menuGrid = document.getElementById("menuGrid");
  try {
    const response = await fetch(`${API_BASE_URL}/api/products`);
    if (!response.ok) throw new Error(`Request gagal dengan status ${response.status}`);

    const products = await response.json();

    // Disimpan supaya openProductDialog() bisa mengisi form edit dengan data
    // produk yang lengkap (termasuk field yang tidak ditampilkan di kartu,
    // seperti width/height/srcset gambar) tanpa perlu fetch ulang satu-satu
    // per produk saat tombol Edit diklik.
    productsById = new Map(products.map((product) => [product.id, product]));

    menuGrid.innerHTML = "";
    products.forEach((product) => {
      menuGrid.appendChild(createMenuCardElement(product));
    });

    menuCards = document.querySelectorAll(".menu-card");
    wireMenuCardQtyButtons();
    updateCartSummary();
    applyLanguage(document.documentElement.lang);
  } catch (error) {
    // Error TIDAK disembunyikan dari user - ditampilkan pesan sederhana di
    // area menu (bukan crash/blank), sekaligus dicatat ke console supaya
    // developer bisa lihat detail error aslinya saat debugging.
    console.error("Gagal memuat menu dari backend:", error);
    const isEnglish = document.documentElement.lang === "en";
    menuGrid.innerHTML = `<p class="menu-error">${
      isEnglish
        ? "Failed to load menu. Please make sure the backend server is running."
        : "Gagal memuat menu. Pastikan server backend sedang berjalan."
    }</p>`;
  }
}

// Ambil & render menu saat halaman pertama kali dimuat. Menggantikan
// pemanggilan updateCartSummary() yang dulu ada di sini langsung - sekarang
// updateCartSummary() dipanggil DARI DALAM loadMenu() (lihat di atas),
// setelah kartu-kartu produk selesai dirender, bukan lagi dipanggil di sini
// saat kartu belum tentu ada.
loadMenu();

// ----------------------------------------------------------
// 3b. PANEL DETAIL PESANAN (LIHAT ISI KERANJANG)
// ----------------------------------------------------------
// Masalah yang mau diselesaikan: bar keranjang di atas cuma menampilkan
// ringkasan (total item & total harga), jadi kalau pelanggan sudah scroll
// jauh dari grid menu, mereka tidak bisa lihat lagi barang apa saja yang
// sudah dipesan tanpa scroll balik ke atas satu per satu.
//
// Solusinya: elemen <dialog> bawaan browser (lihat markup-nya di index.html).
// Dengan showModal(), browser otomatis menyediakan:
// - ::backdrop, lapisan gelap di belakang panel (diberi gaya di style.css)
// - fokus keyboard yang terkunci di dalam panel selama terbuka (tidak bisa
//   Tab keluar ke konten halaman di belakangnya)
// - panel tertutup otomatis saat tombol Escape ditekan
// Semua itu "gratis" tanpa kita tulis kodenya sendiri - inilah alasan kita
// pilih <dialog> dibanding bikin overlay manual seperti pola menu hamburger
// di bagian 1. Satu-satunya perilaku yang belum otomatis dari <dialog> adalah
// "klik di luar panel untuk menutup", jadi itu saja yang perlu ditambah manual
// di bawah.
//
// Bikin satu <li> lengkap (nama, subtotal, tombol +/-, kolom catatan) untuk
// SATU card menu. Dipisah jadi fungsi sendiri supaya renderCartPanel() di
// bawah bisa memanggilnya HANYA untuk item yang baru pertama kali masuk
// keranjang, bukan untuk semua item setiap kali dirender ulang.
function createCartPanelItem(card, cardIndex) {
  const isEnglish = document.documentElement.lang === "en";
  const name = card.querySelector("h3").textContent.trim();

  const item = document.createElement("li");
  item.className = "cart-panel-item";
  // Dipakai renderCartPanel() sebagai "kunci" untuk mencocokkan <li> ini
  // dengan card aslinya, supaya nanti tahu <li> mana yang harus di-update
  // di tempat dan mana yang harus dihapus/dibuat baru.
  item.dataset.cardIndex = cardIndex;

  const info = document.createElement("div");
  info.className = "cart-panel-item-info";

  const nameEl = document.createElement("p");
  nameEl.className = "cart-panel-item-name";
  nameEl.textContent = name;

  // Teks qty & subtotal SENGAJA tidak diisi di sini - selalu diisi oleh
  // renderCartPanel() tepat setelah <li> ini dibuat/ditemukan, supaya
  // logikanya cuma ada di satu tempat baik untuk item baru maupun lama.
  const subtotalEl = document.createElement("p");
  subtotalEl.className = "cart-panel-item-subtotal";

  info.append(nameEl, subtotalEl);

  // Tombol +/- di sini memanggil changeCardQty() yang SAMA dengan tombol
  // di grid menu utama, jadi mengubah qty di panel otomatis juga mengubah
  // qty di card aslinya - tidak ada data ganda yang bisa tidak sinkron.
  const controls = document.createElement("div");
  controls.className = "cart-controls";
  controls.setAttribute("role", "group");
  controls.setAttribute("aria-label", isEnglish ? "Order quantity" : "Jumlah pesanan");

  const decreaseBtn = document.createElement("button");
  decreaseBtn.type = "button";
  decreaseBtn.className = "qty-btn qty-decrease";
  decreaseBtn.setAttribute("aria-label", isEnglish ? "Decrease quantity" : "Kurangi jumlah");
  decreaseBtn.innerHTML = "&minus;";
  decreaseBtn.addEventListener("click", () => changeCardQty(card, -1));

  const qtyEl = document.createElement("span");
  qtyEl.className = "qty-value";
  qtyEl.setAttribute("aria-live", "polite");

  const increaseBtn = document.createElement("button");
  increaseBtn.type = "button";
  increaseBtn.className = "qty-btn qty-increase";
  increaseBtn.setAttribute("aria-label", isEnglish ? "Increase quantity" : "Tambah jumlah");
  increaseBtn.innerHTML = "+";
  increaseBtn.addEventListener("click", () => changeCardQty(card, 1));

  controls.append(decreaseBtn, qtyEl, increaseBtn);

  // Catatan per item (misal "tidak pedas") disimpan langsung di atribut
  // data-note pada card menu aslinya - mengikuti prinsip yang sama seperti
  // qty (data disimpan di DOM card, bukan di variabel/array terpisah).
  // Karena <li> ini sekarang HANYA dibuat sekali saat item pertama masuk
  // keranjang (lihat renderCartPanel di bawah - tidak lagi dibuat ulang
  // tiap render), textarea catatan ini juga tidak akan pernah dihapus &
  // dibuat ulang selama item itu masih ada di keranjang, jadi pelanggan
  // yang sedang mengetik catatan tidak kehilangan posisi kursor atau
  // fokusnya hanya karena mengubah qty item lain.
  // Dipakai <textarea>, bukan <input type="text">, supaya pelanggan bisa
  // menekan Enter untuk pindah baris - beberapa pelanggan suka menulis
  // catatan lebih dari satu baris, apalagi kalau pesan lebih dari satu
  // jenis dan tiap baris menjelaskan hal yang berbeda. rows={2} cukup
  // untuk MVP (tetap ringkas), dan CSS-nya membolehkan resize vertikal
  // kalau pelanggan butuh ruang lebih. maxLength dipasang supaya catatan
  // tidak sampai terlalu panjang dan membuat link WhatsApp gagal terisi.
  const noteInput = document.createElement("textarea");
  noteInput.rows = 2;
  noteInput.maxLength = 200;
  noteInput.className = "cart-panel-item-note";
  noteInput.value = card.dataset.note || "";
  noteInput.setAttribute("aria-label", (isEnglish ? "Note for " : "Catatan untuk ") + name);
  noteInput.placeholder = isEnglish ? "Add a note (optional)" : "Tambahkan catatan (opsional)";
  noteInput.addEventListener("input", (event) => {
    card.dataset.note = event.target.value;
  });

  item.append(info, controls, noteInput);
  return item;
}

// Sama seperti bar keranjang, panel ini membaca ulang SEMUA menuCards
// (termasuk yang sedang disembunyikan filter kategori) setiap kali dibuka
// atau dirender ulang, supaya datanya selalu sinkron dengan satu-satunya
// sumber kebenaran: teks/atribut yang tersimpan di tiap card.
//
// PENTING - ini SENGAJA tidak menghapus lalu membangun ulang seluruh isi
// list setiap kali dipanggil (versi sebelumnya begitu). Masalahnya: kalau
// qty diubah lewat tombol +/- DI DALAM panel ini sendiri, tombol yang baru
// saja diklik ikut terhapus dan diganti elemen baru - browser jadi
// kehilangan fokus keyboard di tombol itu, menyulitkan pengguna
// keyboard/screen reader yang mau menekan tombol yang sama berkali-kali.
// Solusinya: <li> untuk item yang SUDAH ada di keranjang cukup di-update
// teks qty & subtotal-nya saja (elemen tombolnya tetap sama, fokus tidak
// hilang); <li> baru hanya dibuat untuk item yang BARU masuk keranjang;
// <li> dihapus hanya untuk item yang qty-nya jadi 0 (keluar dari keranjang).
function renderCartPanel() {
  // cardIndex (posisi card di antara semua menuCards) dipakai sebagai
  // "kunci" tetap untuk mencocokkan <li> dengan card aslinya - lebih stabil
  // daripada nama produk (teksnya berubah kalau bahasa diganti) atau urutan
  // tampil (bisa berubah kalau ada item masuk/keluar keranjang).
  const cartCardIndexes = [];
  menuCards.forEach((card, cardIndex) => {
    if (getCardQty(card) > 0) cartCardIndexes.push(cardIndex);
  });

  const isEmpty = cartCardIndexes.length === 0;
  cartPanelEmpty.classList.toggle("hide", !isEmpty);
  cartPanelList.classList.toggle("hide", isEmpty);

  if (isEmpty) {
    cartPanelList.innerHTML = "";
    return; // keranjang kosong -> cukup tampilkan pesan kosong di atas
  }

  // (1) Buang <li> untuk item yang qty-nya sudah jadi 0 (dikeluarkan dari keranjang).
  Array.from(cartPanelList.children).forEach((li) => {
    const cardIndex = Number(li.dataset.cardIndex);
    if (!cartCardIndexes.includes(cardIndex)) li.remove();
  });

  // (2) Untuk tiap item yang masih/baru ada di keranjang: kalau <li>-nya
  // sudah ada, cukup perbarui teks qty & subtotal-nya di tempat. Kalau
  // belum ada (item baru), buat satu <li> baru dan sisipkan di posisi yang
  // sesuai urutan menu (bukan selalu ditambah di paling bawah), supaya
  // urutan tampilannya tetap rapi mengikuti urutan di grid menu.
  cartCardIndexes.forEach((cardIndex) => {
    const card = menuCards[cardIndex];
    const qty = getCardQty(card);
    const subtotal = qty * getCardPrice(card);

    let li = cartPanelList.querySelector(`[data-card-index="${cardIndex}"]`);
    if (!li) {
      li = createCartPanelItem(card, cardIndex);
      const nextLi = Array.from(cartPanelList.children).find(
        (child) => Number(child.dataset.cardIndex) > cardIndex
      );
      cartPanelList.insertBefore(li, nextLi || null);
    }

    li.querySelector(".qty-value").textContent = qty;
    li.querySelector(".cart-panel-item-subtotal").textContent = formatRupiah(subtotal);
  });
}

// Klik tombol "Lihat Pesanan" -> render dulu isi panel supaya datanya paling
// baru, baru tampilkan panelnya sebagai modal.
cartViewBtn.addEventListener("click", () => {
  renderCartPanel();
  cartPanel.showModal();
});

// Tombol silang (×) di header panel menutup panel secara manual.
cartPanelCloseBtn.addEventListener("click", () => cartPanel.close());

// <dialog> otomatis tertutup saat tombol Escape ditekan, tapi klik di area
// ::backdrop (bagian gelap di luar kotak panel) tidak otomatis menutup - ini
// satu-satunya perilaku yang perlu ditambah manual. Triknya: bandingkan
// posisi klik dengan posisi kotak panel lewat getBoundingClientRect(); kalau
// titik klik jatuh di luar kotak itu, berarti klik memang di area backdrop,
// jadi panel ditutup.
cartPanel.addEventListener("click", (event) => {
  const panelBox = cartPanel.getBoundingClientRect();
  const clickedOutside =
    event.clientX < panelBox.left ||
    event.clientX > panelBox.right ||
    event.clientY < panelBox.top ||
    event.clientY > panelBox.bottom;

  if (clickedOutside) cartPanel.close();
});

// ==========================================================
// 4. CAROUSEL / SLIDER TESTIMONI
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
const carouselStatus = document.getElementById("carouselStatus");

let currentSlide = 0;
const totalSlides = slides.length;
const AUTO_SLIDE_INTERVAL_MS = 5000;

// Dicek SEKALI saat halaman dimuat (bukan tiap kali auto-slide mau jalan),
// karena preferensi ini praktis tidak pernah berubah selama satu kunjungan -
// pengguna mengaturnya di level OS, bukan di halaman ini. Kalau hasilnya
// true, berarti pengguna sudah bilang ke OS-nya "kurangi animasi/gerakan"
// (misal supaya tidak pusing/terganggu), jadi carousel TIDAK BOLEH bergeser
// otomatis sendiri - navigasi manual lewat tombol prev/next/dot tetap harus
// berfungsi seperti biasa, cuma auto-slide-nya saja yang dimatikan.
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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

  // Umumkan slide yang sedang tampil ke screen reader lewat teks tersembunyi
  // (.visually-hidden), karena transform CSS saja tidak memicu pembacaan otomatis.
  const isEnglish = document.documentElement.lang === "en";
  carouselStatus.textContent = isEnglish
    ? `Testimonial ${currentSlide + 1} of ${totalSlides}`
    : `Testimoni ${currentSlide + 1} dari ${totalSlides}`;
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

// Auto-slide: carousel otomatis geser ke slide berikutnya setiap AUTO_SLIDE_INTERVAL_MS,
// supaya testimoni tetap bergerak walau user tidak berinteraksi.
function startAutoSlide() {
  return setInterval(() => {
    goToSlide((currentSlide + 1) % totalSlides);
  }, AUTO_SLIDE_INTERVAL_MS);
}

// Kalau prefersReducedMotion true, auto-slide tidak pernah dimulai sama
// sekali sejak awal - autoSlideInterval sengaja dibiarkan null (bukan
// dipanggil startAutoSlide()). clearInterval(null) aman dipanggil (tidak
// error), jadi handler mouseleave/focusout di bawah tidak perlu logika
// tambahan untuk kasus ini.
let autoSlideInterval = prefersReducedMotion ? null : startAutoSlide();

// Auto-slide dihentikan saat mouse ATAU fokus keyboard berada di area carousel
// (supaya user tidak terganggu saat membaca, dan pengguna keyboard yang men-Tab
// ke tombol carousel juga tidak kehilangan konten karena tergeser otomatis),
// lalu dilanjutkan lagi saat mouse/fokus keluar dari area carousel - TAPI
// hanya kalau prefersReducedMotion false. Kalau tidak dijaga di sini juga
// (bukan cuma di baris startAutoSlide() awal di atas), auto-slide akan tetap
// menyala lagi begitu mouse/fokus meninggalkan carousel walau pengguna sudah
// minta gerakan dikurangi - makanya guard yang sama perlu diulang di kedua
// handler ini.
const carousel = document.querySelector(".carousel");
carousel.addEventListener("mouseenter", () => clearInterval(autoSlideInterval));
carousel.addEventListener("mouseleave", () => {
  if (!prefersReducedMotion) autoSlideInterval = startAutoSlide();
});
carousel.addEventListener("focusin", () => clearInterval(autoSlideInterval));
carousel.addEventListener("focusout", () => {
  if (!prefersReducedMotion) autoSlideInterval = startAutoSlide();
});

// ==========================================================
// 5. TAHUN OTOMATIS DI FOOTER
// ==========================================================
// Supaya tulisan copyright di footer tidak perlu diedit manual tiap tahun baru.
document.getElementById("year").textContent = new Date().getFullYear();

// ==========================================================
// 6. GANTI BAHASA (ID / EN)
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
    "menu.loading": "Memuat menu...",
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

    "cart.items": "item",
    "cart.checkout": "Pesan via WhatsApp",
    "cart.emptyHint": "Keranjang masih kosong. Tambahkan menu untuk mulai pesan.",
    "cart.qtyGroup": "Jumlah pesanan",
    "cart.decrease": "Kurangi jumlah",
    "cart.increase": "Tambah jumlah",
    "cart.viewOrder": "Lihat Pesanan",
    "cart.panelTitle": "Pesanan Kamu",
    "cart.close": "Tutup",

    // ----- AUTENTIKASI (LOGIN/DAFTAR/LOGOUT) & ADMIN PRODUK (Phase 3D) -----
    // Beberapa key di bawah ini dipasang lewat data-i18n/data-i18n-aria di
    // HTML (label, tombol, placeholder statis - lihat applyLanguage()), tapi
    // beberapa lainnya SENGAJA hanya diambil langsung lewat
    // translations[lang][key] di dalam script.js (bukan data-i18n), karena
    // isinya baru diketahui/berubah saat runtime (contoh: judul dialog yang
    // beda antara mode login/daftar, atau pesan error yang cuma ditampilkan
    // kalau kondisi tertentu terjadi) - pola yang sama seperti #cartStatus
    // atau pesan error di loadMenu() yang juga tidak memakai data-i18n.
    "dialog.close": "Tutup",
    "auth.loginBtn": "Masuk",
    "auth.logoutBtn": "Keluar",
    "auth.loginTitle": "Masuk",
    "auth.registerTitle": "Daftar Akun",
    "auth.emailLabel": "Email",
    "auth.passwordLabel": "Kata Sandi",
    "auth.loginSubmit": "Masuk",
    "auth.registerSubmit": "Daftar",
    "auth.noAccount": "Belum punya akun?",
    "auth.haveAccount": "Sudah punya akun?",
    "auth.switchToRegister": "Daftar di sini",
    "auth.switchToLogin": "Masuk di sini",
    "auth.registerSuccess": "Akun berhasil dibuat, silakan masuk.",
    "auth.sessionExpired": "Sesi kamu sudah berakhir, silakan masuk lagi.",
    "auth.genericError": "Gagal menghubungi server. Pastikan server backend sedang berjalan.",

    "admin.addProductBtn": "+ Tambah Produk",
    "admin.addProductTitle": "Tambah Produk",
    "admin.editProductTitle": "Edit Produk",
    "admin.addProductSubmit": "Simpan Produk",
    "admin.editProductSubmit": "Simpan Perubahan",
    "admin.slugLabel": "Slug",
    "admin.nameLabel": "Nama Produk",
    "admin.descriptionIdLabel": "Deskripsi (Indonesia)",
    "admin.descriptionEnLabel": "Deskripsi (Inggris)",
    "admin.priceLabel": "Harga (Rp)",
    "admin.categoryLabel": "Kategori",
    "admin.imageSrcLabel": "URL Gambar",
    "admin.imageAltLabel": "Teks Alternatif Gambar",
    "admin.imageSizeLabel": "Ukuran Gambar",
    "admin.imageSizeDefaultOption": "Default (700×467)",
    "admin.imageSizeCustomOption": "Custom",
    "admin.imageWidthLabel": "Lebar Gambar (px)",
    "admin.imageHeightLabel": "Tinggi Gambar (px)",
    "admin.imageSrcsetLabel": "Srcset Gambar (opsional)",
    "admin.imageSizesLabel": "Sizes Gambar (opsional)",
    "admin.editBtn": "Edit",
    "admin.deleteBtn": "Hapus",
    "admin.deleteConfirm": "Yakin ingin menghapus produk ini?",
    "admin.permissionDenied": "Kamu tidak punya izin untuk melakukan ini.",
    "admin.rateLimited": "Terlalu banyak percobaan, coba lagi nanti.",
    "admin.genericError": "Terjadi kesalahan, silakan coba lagi.",

    "backToTop.aria": "Kembali ke atas",
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
    "menu.loading": "Loading menu...",
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

    "cart.items": "items",
    "cart.checkout": "Order via WhatsApp",
    "cart.emptyHint": "Your cart is empty. Add a menu item to get started.",
    "cart.qtyGroup": "Order quantity",
    "cart.decrease": "Decrease quantity",
    "cart.increase": "Increase quantity",
    "cart.viewOrder": "View Order",
    "cart.panelTitle": "Your Order",
    "cart.close": "Close",

    "dialog.close": "Close",
    "auth.loginBtn": "Log In",
    "auth.logoutBtn": "Log Out",
    "auth.loginTitle": "Log In",
    "auth.registerTitle": "Create Account",
    "auth.emailLabel": "Email",
    "auth.passwordLabel": "Password",
    "auth.loginSubmit": "Log In",
    "auth.registerSubmit": "Register",
    "auth.noAccount": "Don't have an account?",
    "auth.haveAccount": "Already have an account?",
    "auth.switchToRegister": "Register here",
    "auth.switchToLogin": "Log in here",
    "auth.registerSuccess": "Account created successfully, please log in.",
    "auth.sessionExpired": "Your session has expired, please log in again.",
    "auth.genericError": "Failed to reach the server. Please make sure the backend server is running.",

    "admin.addProductBtn": "+ Add Product",
    "admin.addProductTitle": "Add Product",
    "admin.editProductTitle": "Edit Product",
    "admin.addProductSubmit": "Save Product",
    "admin.editProductSubmit": "Save Changes",
    "admin.slugLabel": "Slug",
    "admin.nameLabel": "Product Name",
    "admin.descriptionIdLabel": "Description (Indonesian)",
    "admin.descriptionEnLabel": "Description (English)",
    "admin.priceLabel": "Price (Rp)",
    "admin.categoryLabel": "Category",
    "admin.imageSrcLabel": "Image URL",
    "admin.imageAltLabel": "Image Alt Text",
    "admin.imageSizeLabel": "Image Size",
    "admin.imageSizeDefaultOption": "Default (700×467)",
    "admin.imageSizeCustomOption": "Custom",
    "admin.imageWidthLabel": "Image Width (px)",
    "admin.imageHeightLabel": "Image Height (px)",
    "admin.imageSrcsetLabel": "Image Srcset (optional)",
    "admin.imageSizesLabel": "Image Sizes (optional)",
    "admin.editBtn": "Edit",
    "admin.deleteBtn": "Delete",
    "admin.deleteConfirm": "Are you sure you want to delete this product?",
    "admin.permissionDenied": "You don't have permission to do this.",
    "admin.rateLimited": "Too many attempts, please try again later.",
    "admin.genericError": "Something went wrong, please try again.",

    "backToTop.aria": "Back to top",
  },
};

const langButtons = document.querySelectorAll(".lang-btn");
// CATATAN: dulu di sini ada i18nElements/i18nAriaElements yang di-query
// SEKALI saja lewat querySelectorAll (dicache di variabel top-level). Itu
// masalah sejak Phase 2B: kartu produk (dan atribut data-i18n/data-i18n-aria
// di dalamnya) baru muncul di DOM belakangan, setelah fetch() ke backend
// selesai (lihat loadMenu()) - jauh SETELAH baris ini pertama kali jalan.
// NodeList lama itu tidak akan pernah "melihat" elemen yang baru muncul
// kemudian. Solusinya: applyLanguage() di bawah sekarang query ULANG
// document.querySelectorAll("[data-i18n]"/"[data-i18n-aria]") secara LIVE
// setiap kali dipanggil, supaya selalu menemukan elemen yang ada di DOM
// SAAT ITU JUGA - baik elemen statis dari awal maupun kartu produk yang baru
// disisipkan loadMenu().

// localStorage bisa melempar error di beberapa browser (misal Safari Private Browsing),
// jadi dibungkus try/catch supaya fitur ganti bahasa tidak ikut rusak kalau itu terjadi.
function getStoredLang() {
  try {
    return localStorage.getItem("sari-rasa-lang");
  } catch (e) {
    return null;
  }
}

function setStoredLang(lang) {
  try {
    localStorage.setItem("sari-rasa-lang", lang);
  } catch (e) {
    // diamkan saja: bahasa tetap berfungsi untuk sesi ini walau tidak tersimpan
  }
}

function applyLanguage(lang) {
  // Query ULANG setiap kali dipanggil (bukan pakai NodeList yang di-cache di
  // top-level) - lihat catatan di atas deklarasi langButtons untuk alasannya.
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    const text = translations[lang][key];
    if (text !== undefined) el.innerHTML = text;
  });

  // Sama seperti di atas, tapi hasilnya dipasang ke atribut aria-label,
  // bukan innerHTML (dipakai elemen seperti tombol +/- kuantitas keranjang
  // yang teksnya cuma simbol "−"/"+", bukan teks biasa untuk screen reader).
  document.querySelectorAll("[data-i18n-aria]").forEach((el) => {
    const key = el.getAttribute("data-i18n-aria");
    const text = translations[lang][key];
    if (text !== undefined) el.setAttribute("aria-label", text);
  });

  langButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.lang === lang));
  document.documentElement.lang = lang;
  setStoredLang(lang);

  // Deskripsi produk (Phase 3E) tidak ikut ter-update lewat sweep [data-i18n]
  // di atas - lihat komentar lengkap di updateProductDescriptions() (bagian 9a)
  // dan di createMenuCardElement() (bagian 3c) untuk alasannya.
  updateProductDescriptions(lang);
}

langButtons.forEach((btn) => {
  btn.addEventListener("click", () => applyLanguage(btn.dataset.lang));
});

// Bahasa terakhir yang dipilih customer disimpan di localStorage,
// jadi tetap konsisten walau halaman di-refresh atau dibuka lagi nanti.
applyLanguage(getStoredLang() || "id");

// ==========================================================
// 7. MENU NAVIGASI AKTIF SAAT SCROLL
// ==========================================================
// Menyorot link navigasi yang sesuai dengan section yang sedang dilihat,
// memakai IntersectionObserver (lebih ringan daripada event "scroll" manual).
// rootMargin mengecilkan area deteksi jadi pita tipis di tengah layar, jadi
// section yang dianggap "aktif" adalah section yang melintasi pita itu.
const sections = document.querySelectorAll("section[id]");

const sectionObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      navLinks.forEach((link) => {
        link.classList.toggle("active-link", link.getAttribute("href") === `#${entry.target.id}`);
      });
    });
  },
  { rootMargin: "-40% 0px -55% 0px" }
);

sections.forEach((section) => sectionObserver.observe(section));

// ==========================================================
// 8. TOMBOL KEMBALI KE ATAS (BACK TO TOP)
// ==========================================================
// Tombol kecil yang muncul begitu pengunjung sudah scroll melewati hero
// (#beranda), supaya tidak perlu scroll manual jauh-jauh untuk balik ke
// atas. Memakai IntersectionObserver lagi (pola yang sama seperti "MENU
// NAVIGASI AKTIF SAAT SCROLL" di bagian 7 di atas) - lebih ringan daripada
// mendengarkan event "scroll" manual yang bisa terpicu ratusan kali per
// detik. Sengaja dibuat observer BARU (bukan menumpang di sectionObserver
// yang sudah ada), karena rootMargin yang dibutuhkan beda tujuan: observer
// di bagian 7 memakai pita tipis di tengah layar untuk nav highlight,
// sedangkan di sini kita cuma perlu tahu satu hal sederhana - apakah hero
// masih terlihat di layar atau tidak.
const backToTopBtn = document.getElementById("backToTopBtn");
const heroSection = document.getElementById("beranda");

const heroObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    // Tombol ditampilkan begitu hero TIDAK LAGI terlihat (berarti pengunjung
    // sudah scroll melewatinya), disembunyikan lagi kalau hero terlihat
    // kembali (misal pengunjung scroll balik ke atas).
    backToTopBtn.classList.toggle("is-visible", !entry.isIntersecting);
  });
});

heroObserver.observe(heroSection);

// Klik tombol -> scroll halus ke paling atas halaman.
//
// CATATAN PENTING: "scroll-behavior: smooth" di CSS (lihat style.css bagian
// 1) HANYA berlaku untuk scroll yang dipicu lewat link anchor atau navigasi
// keyboard, BUKAN untuk scroll yang dipicu lewat JavaScript seperti
// window.scrollTo() di bawah ini - jadi opsi "behavior"-nya perlu diatur
// manual di sini, dengan tetap menghormati preferensi prefers-reduced-motion
// pengguna (persis seperti alasan yang sama dipakai untuk auto-slide
// carousel di bagian 4).
backToTopBtn.addEventListener("click", () => {
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  window.scrollTo({
    top: 0,
    behavior: prefersReducedMotion ? "auto" : "smooth",
  });
});

// Dua percobaan sebelumnya di sini mencoba membuat tombol ini "berlabuh"
// (pindah dari position:fixed ke position:absolute) begitu footer terlihat,
// supaya tidak menimpa link "Kontak" di .footer-links. Keduanya malah
// menimbulkan bug baru (tombol "terbang"/menghilang sesaat saat discroll),
// karena mengubah SKEMA POSISI tombol di tengah-tengah scroll itu sendiri
// yang rumit untuk dibuat mulus tanpa terlihat "melompat".
//
// Solusi yang jauh lebih sederhana: tombol TETAP "position: fixed" selamanya
// (tidak pernah berpindah skema posisi sama sekali) - lihat style.css bagian
// 8/10. Ruang aman di sana dihitung supaya posisi tombol yang tetap itu
// (94px dari dasar layar di desktop, 160px di mobile) selalu berada di
// celah kosong antara .cart-bar di bawahnya dan baris teks .footer-links di
// atasnya, di breakpoint manapun - jadi tidak perlu logika scroll/observer
// tambahan sama sekali untuk masalah ini.

// ==========================================================
// 9. AUTENTIKASI (LOGIN/DAFTAR/LOGOUT) & ADMIN PRODUK
// ==========================================================
// Ditambahkan di Phase 3D. Sumber kebenaran status login SELALU backend
// (cookie sesi httpOnly yang tidak bisa & tidak perlu dibaca langsung lewat
// JS - browser yang otomatis mengirimkannya tiap fetch() diberi
// "credentials: 'include'"), BUKAN localStorage/sessionStorage. Variabel
// "currentUser" di bawah cuma cache sementara untuk kebutuhan TAMPILAN
// selama halaman ini terbuka (misal supaya tidak perlu fetch ulang setiap
// mau tahu role user) - begitu halaman di-refresh, cache ini hilang dan
// checkAuthState() akan menanyakan ulang ke backend lewat GET /api/auth/me.
//
// Prinsip yang sama seperti loadMenu() dipakai berulang kali di bagian ini:
// setiap kali data produk berubah (create/edit/delete berhasil), kita tidak
// menyisipkan/mengubah kartu secara manual di DOM - cukup panggil ulang
// loadMenu() supaya grid selalu diambil segar dari server (sumber kebenaran).
//
// PENTING soal keamanan: semua pengecekan role admin di FILE INI (menyembunyikan
// tombol, dsb) murni soal TAMPILAN. Satu-satunya penjaga yang sungguhan
// adalah backend (requireAuth/requireAdmin di server.js) - kalaupun ada yang
// memanggil endpoint admin langsung lewat DevTools tanpa lewat tombol apa pun
// di sini, backend tetap akan menolaknya kalau dia bukan admin yang sah.
let currentUser = null; // null = anonim, atau {id, email, role} kalau sedang login
let authMode = "login"; // "login" | "register" - mode aktif dialog #authDialog
let editingProductId = null; // id produk yang sedang diedit di #productDialog, null = mode "tambah baru"
let productsById = new Map(); // diisi ulang tiap loadMenu() sukses fetch - dipakai untuk pre-fill form edit & pesan konfirmasi hapus

const authLoginBtn = document.getElementById("authLoginBtn");
const authAccount = document.getElementById("authAccount");
const authEmailText = document.getElementById("authEmailText");
const authLogoutBtn = document.getElementById("authLogoutBtn");

const authDialog = document.getElementById("authDialog");
const authDialogCloseBtn = document.getElementById("authDialogCloseBtn");
const authDialogTitle = document.getElementById("authDialogTitle");
const authForm = document.getElementById("authForm");
const authFormMessage = document.getElementById("authFormMessage");
const authEmailInput = document.getElementById("authEmailInput");
const authPasswordInput = document.getElementById("authPasswordInput");
const authSubmitBtn = document.getElementById("authSubmitBtn");
const authSwitchText = document.getElementById("authSwitchText");
const authSwitchModeBtn = document.getElementById("authSwitchModeBtn");

const adminMenuActions = document.getElementById("adminMenuActions");
const adminAddProductBtn = document.getElementById("adminAddProductBtn");

const productDialog = document.getElementById("productDialog");
const productDialogCloseBtn = document.getElementById("productDialogCloseBtn");
const productDialogTitle = document.getElementById("productDialogTitle");
const productForm = document.getElementById("productForm");
const productFormMessage = document.getElementById("productFormMessage");
const productSlugInput = document.getElementById("productSlugInput");
const productNameInput = document.getElementById("productNameInput");
// Deskripsi produk (Phase 3E) - lihat komentar WHY lengkap di index.html tepat
// di atas markup dua textarea ini, dan komentar di getProductDescriptionText()
// di bagian 9a di bawah untuk penjelasan lengkap jalur cadangannya.
const productDescriptionIdInput = document.getElementById("productDescriptionIdInput");
const productDescriptionEnInput = document.getElementById("productDescriptionEnInput");
const productPriceInput = document.getElementById("productPriceInput");
// "type=text" (bukan "number") - input type="number" menolak karakter non-angka
// seperti "." yang dipakai di sini sebagai pemisah ribuan, jadi tidak mungkin
// menampilkan "10.000" lewat type="number". Diformat ulang tiap kali diketik
// supaya tampil ala Indonesia (10000 -> "10.000"); nilai mentahnya dipulihkan
// dengan membuang titik sebelum dikirim ke API (lihat submit handler #productForm).
// Reassign ke ".value" secara normal bikin posisi kursor lompat ke ujung
// string, jadi kalau user coba edit digit di TENGAH angka yang sudah
// diformat (mis. ubah "1.234.567" jadi "1.324.567"), kursor selalu kepental
// ke akhir setelah tiap ketikan. Fix-nya: hitung berapa digit yang ada
// SEBELUM posisi kursor (bukan posisi karakter mentah, karena titik pemisah
// ribuan bisa nambah/berkurang setelah diformat ulang dan menggeser posisi
// karakter), lalu pulihkan kursor ke digit yang sama persis di string baru.
productPriceInput.addEventListener("input", () => {
  const rawValue = productPriceInput.value;
  const cursorPos = productPriceInput.selectionStart;

  const digitsBeforeCursor = rawValue.slice(0, cursorPos).replace(/\D/g, "").length;

  const digitsOnly = rawValue.replace(/\D/g, "");
  const formatted = digitsOnly ? Number(digitsOnly).toLocaleString("id-ID") : "";
  productPriceInput.value = formatted;

  let newCursorPos = 0;
  let digitsSeen = 0;
  while (newCursorPos < formatted.length && digitsSeen < digitsBeforeCursor) {
    if (/\d/.test(formatted[newCursorPos])) digitsSeen++;
    newCursorPos++;
  }
  productPriceInput.setSelectionRange(newCursorPos, newCursorPos);
});
const productCategoryInput = document.getElementById("productCategoryInput");
const productImageSrcInput = document.getElementById("productImageSrcInput");
const productImageAltInput = document.getElementById("productImageAltInput");
const productImageSizeButtons = document.querySelectorAll(".image-size-btn");
const productImageWidthInput = document.getElementById("productImageWidthInput");
const productImageHeightInput = document.getElementById("productImageHeightInput");
const productImageSrcsetInput = document.getElementById("productImageSrcsetInput");
const productImageSizesInput = document.getElementById("productImageSizesInput");
const productSubmitBtn = document.getElementById("productSubmitBtn");

// ----------------------------------------------------------
// 9a. HELPER KECIL (dipakai berulang di bagian ini)
// ----------------------------------------------------------

// Menampilkan pesan error/sukses di elemen <p class="form-message" aria-live="polite">
// (dipakai #authFormMessage & #productFormMessage) - pola yang sama seperti
// #cartStatus/#carouselStatus yang juga mengandalkan aria-live untuk
// mengumumkan perubahan ke screen reader, cuma di sini pesannya memang
// sengaja TERLIHAT (bukan visually-hidden) karena harus dibaca langsung oleh
// semua pengguna, bukan cuma diumumkan ke screen reader.
function showFormMessage(el, text, type = "error") {
  el.textContent = text;
  el.classList.remove("hide", "error", "success");
  el.classList.add(type);
}

function hideFormMessage(el) {
  el.classList.add("hide");
  el.textContent = "";
}

// Pesan error dari backend SELALU berbentuk {status:'error', message, details?}
// (lihat catatan di server.js) - kalau "details" ada isinya, itu daftar pesan
// validasi yang lebih spesifik dan harus diprioritaskan ditampilkan daripada
// "message" yang lebih umum. Pesan-pesan ini sudah dalam Bahasa Indonesia
// langsung dari backend - SENGAJA ditampilkan apa adanya (tidak diterjemahkan
// ke Inggris), di luar cakupan Phase 3D ini.
function getBackendErrorMessage(data, fallback) {
  if (data && Array.isArray(data.details) && data.details.length > 0) {
    return data.details.join(" ");
  }
  if (data && data.message) return data.message;
  return fallback;
}

// Prioritas tampilan deskripsi produk di menu publik (Phase 3E):
// 1. Deskripsi dari database di BAHASA YANG SEDANG AKTIF (product.description.id/en)
// 2. Kalau kosong, coba bahasa SATUNYA dari database (lebih baik tampil dalam bahasa
//    "salah" daripada kotak kosong sama sekali - pembeli tetap dapat info produknya)
// 3. Kalau keduanya kosong di database (produk lama yang belum pernah disentuh admin
//    lewat form ini), fallback ke kamus terjemahan statis lama (translations[lang])
//    - supaya 11 produk awal TIDAK BERUBAH tampilannya sama sekali dari sebelumnya
//    (kolom description_id/description_en mereka di database masih string kosong).
function getProductDescriptionText(product, lang) {
  const otherLang = lang === "id" ? "en" : "id";
  if (product.description && product.description[lang]) return product.description[lang];
  if (product.description && product.description[otherLang]) return product.description[otherLang];
  return (translations[lang] && translations[lang][`product.${product.slug}.desc`]) || "";
}

// Dipanggil dari applyLanguage() setiap kali bahasa diganti - update ulang teks
// deskripsi di SETIAP kartu menu yang sedang tampil, karena deskripsi sekarang
// tidak lagi otomatis ikut diterjemahkan lewat mekanisme data-i18n biasa (lihat
// komentar di createMenuCardElement() bagian 3c soal kenapa elemen desc di sana
// sengaja TIDAK diberi atribut data-i18n lagi).
function updateProductDescriptions(lang) {
  document.querySelectorAll(".menu-card").forEach((card) => {
    const productId = Number(card.dataset.productId);
    const product = productsById.get(productId);
    if (!product) return;
    const descEl = card.querySelector(".menu-card-desc");
    if (descEl) descEl.textContent = getProductDescriptionText(product, lang);
  });
}

// Sama seperti trik "klik di luar kotak dialog = tutup" yang sudah dijelaskan
// panjang lebar di listener klik #cartPanel (bagian 3b) - diulang di sini
// sebagai fungsi kecil (bukan disalin dua kali) karena dipakai oleh DUA
// dialog baru (#authDialog & #productDialog), bukan cuma satu seperti cartPanel.
function isBackdropClick(dialog, event) {
  const box = dialog.getBoundingClientRect();
  return (
    event.clientX < box.left ||
    event.clientX > box.right ||
    event.clientY < box.top ||
    event.clientY > box.bottom
  );
}

// ----------------------------------------------------------
// 9b. RENDER TAMPILAN NAVBAR SESUAI STATUS LOGIN
// ----------------------------------------------------------
// Menentukan mana dari dua elemen sibling (#authLoginBtn vs #authAccount)
// yang kena class "hide" - pola toggle yang sama seperti .cart-hint.hide,
// bukan mekanisme show/hide baru. Juga menampilkan/menyembunyikan tombol
// "+ Tambah Produk" (#adminMenuActions) tergantung role.
function renderAuthUI() {
  const isLoggedIn = !!currentUser;
  authLoginBtn.classList.toggle("hide", isLoggedIn);
  authAccount.classList.toggle("hide", !isLoggedIn);
  if (isLoggedIn) authEmailText.textContent = currentUser.email;

  const isAdmin = isLoggedIn && currentUser.role === "admin";
  adminMenuActions.classList.toggle("hide", !isAdmin);
}

// ----------------------------------------------------------
// 9c. CEK STATUS LOGIN SAAT HALAMAN DIMUAT
// ----------------------------------------------------------
// Dipanggil sekali di akhir bagian ini (lihat pemanggilan di paling bawah),
// sejajar dengan pemanggilan loadMenu() di bagian 3c. GET /api/auth/me
// membaca cookie sesi (dikirim otomatis lewat "credentials: 'include'') dan
// membalas 200 + data user kalau valid, atau 401 kalau tidak/belum login.
async function checkAuthState() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/auth/me`, {
      credentials: "include",
    });

    if (response.ok) {
      const data = await response.json();
      currentUser = data.user;
    } else {
      // 401 di sini BUKAN error yang perlu ditampilkan ke pengunjung -
      // artinya dia memang belum/tidak sedang login. Cukup dianggap anonim.
      currentUser = null;
    }
  } catch (error) {
    // Backend tidak bisa dihubungi sama sekali (misal server belum jalan).
    // Dicatat ke console untuk developer, tapi pengecekan ini sifatnya
    // "diam-diam" di background - tidak seharusnya mengganggu pengunjung
    // dengan pesan error hanya karena pengecekan status login gagal.
    console.error("Gagal memeriksa status login:", error);
    currentUser = null;
  }

  renderAuthUI();

  // Kartu menu dari pemanggilan loadMenu() paling awal (bagian 3c) sudah
  // sempat dirender SEBELUM status login ini diketahui (fetch di atas perlu
  // waktu) - jadi kalau ternyata pengunjung ini admin, render ulang supaya
  // tombol Edit/Hapus muncul di tiap kartu.
  if (currentUser && currentUser.role === "admin") loadMenu();
}

// ----------------------------------------------------------
// 9d. DIALOG LOGIN & DAFTAR AKUN
// ----------------------------------------------------------
// Satu <dialog> dipakai bergantian untuk mode login/daftar (lihat komentar
// lengkap di index.html) - fungsi ini yang mengganti judul, teks tombol, dan
// teks ajakan pindah mode, sesuai mode aktif. Dipanggil langsung lewat
// translations[lang][key] (bukan data-i18n) karena isinya berubah tergantung
// mode, bukan teks statis yang cukup diisi sekali oleh applyLanguage().
function setAuthMode(mode) {
  authMode = mode;
  const lang = document.documentElement.lang;
  const isLogin = mode === "login";

  authDialogTitle.textContent = translations[lang][isLogin ? "auth.loginTitle" : "auth.registerTitle"];
  authSubmitBtn.textContent = translations[lang][isLogin ? "auth.loginSubmit" : "auth.registerSubmit"];
  authSwitchText.textContent = translations[lang][isLogin ? "auth.noAccount" : "auth.haveAccount"];
  authSwitchModeBtn.textContent = translations[lang][isLogin ? "auth.switchToRegister" : "auth.switchToLogin"];
  hideFormMessage(authFormMessage);
}

authLoginBtn.addEventListener("click", () => {
  setAuthMode("login");
  authForm.reset();
  authDialog.showModal();
});

authSwitchModeBtn.addEventListener("click", () => {
  setAuthMode(authMode === "login" ? "register" : "login");
  authForm.reset();
});

authDialogCloseBtn.addEventListener("click", () => authDialog.close());

authDialog.addEventListener("click", (event) => {
  if (isBackdropClick(authDialog, event)) authDialog.close();
});

// Submit form login/daftar - endpoint dan penanganan sukses beda tergantung
// authMode, tapi struktur try/catch/fetch-nya sengaja disamakan persis
// dengan loadMenu() di bagian 3c (fetch -> cek response.ok -> proses ->
// catch untuk error koneksi), bukan pola error-handling yang baru.
authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  hideFormMessage(authFormMessage);

  const lang = document.documentElement.lang;
  const email = authEmailInput.value.trim();
  const password = authPasswordInput.value;
  const endpoint = authMode === "login" ? "/api/auth/login" : "/api/auth/register";

  authSubmitBtn.disabled = true;
  try {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ email, password }),
    });
    const data = await response.json().catch(() => null);

    if (!response.ok) {
      showFormMessage(authFormMessage, getBackendErrorMessage(data, translations[lang]["auth.genericError"]));
      return;
    }

    if (authMode === "register") {
      // Daftar berhasil TIDAK otomatis login (backend cuma membuat akun,
      // belum membuat sesi/cookie) - pindahkan ke mode login supaya
      // pengunjung lanjut masuk pakai akun yang baru saja dibuat, alih-alih
      // menutup dialog begitu saja seolah-olah sudah login.
      setAuthMode("login");
      authForm.reset();
      authEmailInput.value = email;
      showFormMessage(authFormMessage, translations[lang]["auth.registerSuccess"], "success");
      return;
    }

    // Login berhasil - cookie sesi sudah diset browser lewat header
    // Set-Cookie di response ini. checkAuthState() dipanggil ulang supaya
    // currentUser terisi LENGKAP dengan role (endpoint login sendiri cuma
    // membalas {id, email}, role baru diketahui lewat GET /api/auth/me).
    authDialog.close();
    authForm.reset();
    await checkAuthState();
  } catch (error) {
    console.error("Gagal menghubungi server saat login/daftar:", error);
    showFormMessage(authFormMessage, translations[lang]["auth.genericError"]);
  } finally {
    authSubmitBtn.disabled = false;
  }
});

// ----------------------------------------------------------
// 9e. LOGOUT
// ----------------------------------------------------------
authLogoutBtn.addEventListener("click", async () => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/auth/logout`, {
      method: "POST",
      credentials: "include",
    });
    if (!response.ok) {
      console.error("Gagal logout, status:", response.status);
    }
  } catch (error) {
    console.error("Gagal menghubungi server saat logout:", error);
  } finally {
    // JANGAN asumsikan logout berhasil hanya karena request selesai (atau
    // bahkan kalau gagal) - verifikasi ulang status login SEBENARNYA ke
    // server lewat checkAuthState(), sama seperti saat halaman pertama
    // dimuat, supaya tampilan tidak "berbohong" bilang sudah logout padahal
    // sesi di server mungkin masih hidup (misal kalau request logout di atas
    // gagal terkirim karena masalah jaringan) - penting untuk skenario
    // komputer bersama/publik. loadMenu() dipanggil lagi TANPA syarat di
    // baris berikutnya karena checkAuthState() sendiri cuma memanggil
    // loadMenu() kalau user ternyata MASIH admin - di sini kita perlu grid
    // tetap ter-refresh WALAUPUN ternyata user benar-benar sudah logout
    // (supaya tombol Edit/Hapus yang sempat tampil sebelumnya ikut hilang).
    await checkAuthState();
    loadMenu();
  }
});

// ----------------------------------------------------------
// 9f. DIALOG FORM PRODUK (ADMIN: TAMBAH & EDIT)
// ----------------------------------------------------------
// 700x467 = rasio 3:2, SAMA PERSIS dengan aspect-ratio yang dipakai
// .card-photo di style.css untuk menampilkan foto produk di menu publik, dan
// juga nilai yang konsisten dipakai ke-11 produk awal. Dipakai sebagai nilai
// "Default" pada toggle Ukuran Gambar di bawah - lihat komentar WHY lengkap
// di index.html tepat di atas markup fieldset-nya untuk alasan kenapa field
// lebar/tinggi gambar ini TIDAK mengubah tampilan foto sama sekali.
const DEFAULT_IMAGE_WIDTH = 700;
const DEFAULT_IMAGE_HEIGHT = 467;

// Kunci/buka field lebar & tinggi gambar sesuai mode toggle yang dipilih.
// "custom" SENGAJA tidak mengubah nilai field sama sekali (cuma melepas
// readonly) - baik nilai 700/467 dari mode Default sebelumnya, maupun nilai
// asli produk yang sedang diedit, dibiarkan apa adanya sebagai titik awal
// yang lalu bisa diubah admin - supaya nilai custom yang sudah ada di
// database tidak pernah diam-diam terhapus/tertimpa hanya karena membuka
// toggle ini.
function setImageSizeMode(mode) {
  const isDefault = mode === "default";
  productImageWidthInput.readOnly = isDefault;
  productImageHeightInput.readOnly = isDefault;
  if (isDefault) {
    productImageWidthInput.value = DEFAULT_IMAGE_WIDTH;
    productImageHeightInput.value = DEFAULT_IMAGE_HEIGHT;
  }
}

// Pindahkan status "active"/aria-pressed ke tombol yang sesuai "mode" -
// dipisah dari setImageSizeMode() (yang urusannya cuma kunci/isi field lebar-
// tinggi) supaya fungsi ini bisa dipanggil DUA tempat: dari klik tombol di
// bawah, dan dari openProductDialog() saat dialog baru dibuka - pola yang
// sama seperti closeMobileMenu()/isBackdropClick() yang juga dipisah jadi
// fungsi berdiri sendiri supaya logikanya tidak ditulis ulang di banyak
// tempat berbeda.
function setImageSizeToggleUI(mode) {
  productImageSizeButtons.forEach((btn) => {
    const isActive = btn.dataset.sizeMode === mode;
    btn.classList.toggle("active", isActive);
    btn.setAttribute("aria-pressed", isActive);
  });
}

// Sama seperti listener klik .filter-btn di bagian 2: pindahkan status
// active/aria-pressed ke tombol yang baru diklik, lalu jalankan efek
// sungguhannya (di sini: setImageSizeMode() yang mengunci/mengisi field).
productImageSizeButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const mode = btn.dataset.sizeMode;
    setImageSizeToggleUI(mode);
    setImageSizeMode(mode);
  });
});

// Mengisi ulang tiap input di #productForm dari satu objek produk (diambil
// dari cache "productsById" yang diisi loadMenu()) - dipakai HANYA saat
// membuka dialog dalam mode edit.
function fillProductForm(product) {
  productSlugInput.value = product.slug;
  productNameInput.value = product.name;
  // Optional chaining + "|| \"\"" jaga-jaga kalau ada objek produk lama di
  // cache yang entah bagaimana belum punya field "description" sama sekali
  // (misal dari cache lama sebelum backend menambahkan kolom ini) - walau
  // setelah perubahan backend field ini selalu ada, penjagaan ini murah dan
  // sejalan dengan gaya defensif file ini di tempat lain (mis. product.image.srcset || "").
  productDescriptionIdInput.value = product.description?.id || "";
  productDescriptionEnInput.value = product.description?.en || "";
  productPriceInput.value = product.price.toLocaleString("id-ID");
  productCategoryInput.value = product.category;
  productImageSrcInput.value = product.image.src;
  productImageAltInput.value = product.image.alt;
  productImageWidthInput.value = product.image.width;
  productImageHeightInput.value = product.image.height;
  productImageSrcsetInput.value = product.image.srcset || "";
  productImageSizesInput.value = product.image.sizes || "";
}

// mode: "create" (form kosong, POST /api/products) atau "edit" (form terisi
// data produk lama, PUT /api/products/:id) - "editingProductId" dipakai
// submit handler di bawah untuk tahu endpoint mana yang harus dipanggil.
function openProductDialog(mode, productId) {
  const lang = document.documentElement.lang;
  editingProductId = mode === "edit" ? productId : null;

  productForm.reset();
  hideFormMessage(productFormMessage);

  if (mode === "edit") {
    productDialogTitle.textContent = translations[lang]["admin.editProductTitle"];
    productSubmitBtn.textContent = translations[lang]["admin.editProductSubmit"];
    // Slug dikunci saat edit karena mengubah slug produk lama akan memutus
    // pemetaan ke deskripsinya (deskripsi diambil dari kamus terjemahan
    // berdasarkan slug, bukan dari database) - mengunci field ini mencegah
    // admin tidak sengaja menghapus deskripsi produk yang sudah ada. Produk
    // baru (mode create) tetap tidak akan punya deskripsi untuk saat ini -
    // itu keterbatasan yang sudah diketahui dan diterima, di luar scope
    // perbaikan ini.
    productSlugInput.readOnly = true;
    const product = productsById.get(productId);
    if (product) {
      fillProductForm(product);
      // Kalau ukuran gambar produk yang sedang diedit persis 700x467, toggle
      // dibuka dalam mode "Default" (field terkunci, tampilkan 700/467).
      // Kalau BUKAN 700x467 (berarti memang sengaja diisi custom sebelumnya),
      // toggle dibuka dalam mode "Custom" dengan field TETAP terisi nilai
      // asli produk itu (fillProductForm() di atas sudah mengisinya) - supaya
      // nilai custom yang sudah ada di database tidak pernah disembunyikan
      // atau diam-diam dibuang begitu saja.
      const isDefaultSize =
        product.image.width === DEFAULT_IMAGE_WIDTH && product.image.height === DEFAULT_IMAGE_HEIGHT;
      setImageSizeToggleUI(isDefaultSize ? "default" : "custom");
      setImageSizeMode(isDefaultSize ? "default" : "custom");
    }
  } else {
    productDialogTitle.textContent = translations[lang]["admin.addProductTitle"];
    productSubmitBtn.textContent = translations[lang]["admin.addProductSubmit"];
    // Buka kunci slug lagi di mode "tambah baru" - sama seperti alasan toggle
    // ukuran gambar di bawah diset eksplisit di sini: form.reset() tidak
    // menyentuh properti DOM readOnly, jadi kalau dialog sebelumnya sempat
    // dibuka dalam mode edit (yang mengunci slug), field ini perlu dibuka
    // kuncinya secara eksplisit supaya mode create tetap bisa diisi slug baru.
    productSlugInput.readOnly = false;
    // Mode "tambah baru" selalu mulai dari toggle "Default" (700x467, field
    // terkunci) - form.reset() di atas TIDAK menyentuh tombol .image-size-btn
    // sama sekali (reset() bawaan browser hanya berlaku untuk elemen
    // form-associated seperti input/select, bukan <button> biasa), jadi status
    // toggle & readonly field tetap perlu diset eksplisit di sini supaya
    // selalu kembali ke "Default" walau dialog sebelumnya sempat dibuka dalam
    // mode edit "Custom".
    setImageSizeToggleUI("default");
    setImageSizeMode("default");
  }

  productDialog.showModal();
}

adminAddProductBtn.addEventListener("click", () => openProductDialog("create"));
productDialogCloseBtn.addEventListener("click", () => productDialog.close());

productDialog.addEventListener("click", (event) => {
  if (isBackdropClick(productDialog, event)) productDialog.close();
});

// Dipakai submit form produk MAUPUN handleDeleteProduct() di bawah - satu
// tempat untuk menangani tiga status HTTP yang butuh pesan khusus (bukan
// sekadar menampilkan "message" mentah dari backend): 401 berarti sesi admin
// sudah berakhir (perlu login ulang), 403 berarti bukan admin (harusnya
// jarang terjadi karena tombolnya saja disembunyikan dari non-admin, tapi
// backend tetap bisa menolak kalau ada yang memaksa lewat DevTools), dan 429
// berarti kena rate limit. Balikan true kalau salah satu dari ketiganya
// terjadi (pesan sudah ditampilkan, caller cukup berhenti di situ).
// "showMessage" adalah callback, bukan elemen DOM tertentu, karena dua
// caller-nya menampilkan pesan dengan cara berbeda: submit form produk
// memakai showFormMessage() ke #productFormMessage (ada dialog yang sedang
// terbuka), sedangkan handleDeleteProduct() memakai alert() (tidak ada
// dialog/form yang terbuka saat tombol Hapus diklik).
function handleAdminAuthError(response, showMessage) {
  const lang = document.documentElement.lang;
  if (response.status === 401) {
    currentUser = null;
    renderAuthUI();
    showMessage(translations[lang]["auth.sessionExpired"]);
    loadMenu();
    return true;
  }
  if (response.status === 403) {
    showMessage(translations[lang]["admin.permissionDenied"]);
    return true;
  }
  if (response.status === 429) {
    showMessage(translations[lang]["admin.rateLimited"]);
    return true;
  }
  return false;
}

productForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  hideFormMessage(productFormMessage);
  const lang = document.documentElement.lang;

  // Body dibangun mengikuti bentuk yang diminta backend persis (lihat
  // catatan kontrak API): srcset/sizes cuma disertakan kalau memang diisi,
  // karena skemanya membolehkan keduanya kosong/null.
  const body = {
    slug: productSlugInput.value.trim(),
    name: productNameInput.value.trim(),
    // SELALU dikirim dua-duanya (walau salah satu/keduanya kosong) - TIDAK
    // dibuang seperti srcset/sizes gambar di bawah (yang memang boleh tidak
    // disertakan sama sekali), karena backend selalu mengharapkan field
    // "description.id"/"description.en" bertipe string (boleh string kosong,
    // tidak boleh hilang). Lihat getProductDescriptionText() di bagian 9a
    // untuk jalur cadangan tampilan kalau salah satu/keduanya memang kosong.
    description: {
      id: productDescriptionIdInput.value.trim(),
      en: productDescriptionEnInput.value.trim(),
    },
    // Nilainya mengandung titik pemisah ribuan (misal "10.000") - dibuang dulu
    // sebelum Number(), karena Number("10.000") kalau tidak akan dibaca JS
    // sebagai 10.000 dengan titik = desimal (hasilnya 10, bukan 10000).
    price: Number(productPriceInput.value.replace(/\./g, "")),
    category: productCategoryInput.value,
    image: {
      src: productImageSrcInput.value.trim(),
      alt: productImageAltInput.value.trim(),
      width: Number(productImageWidthInput.value),
      height: Number(productImageHeightInput.value),
    },
  };
  if (productImageSrcsetInput.value.trim()) body.image.srcset = productImageSrcsetInput.value.trim();
  if (productImageSizesInput.value.trim()) body.image.sizes = productImageSizesInput.value.trim();

  const isEdit = editingProductId !== null;
  const url = isEdit ? `${API_BASE_URL}/api/products/${editingProductId}` : `${API_BASE_URL}/api/products`;
  const method = isEdit ? "PUT" : "POST";

  productSubmitBtn.disabled = true;
  try {
    const response = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });

    if (handleAdminAuthError(response, (msg) => showFormMessage(productFormMessage, msg))) return;

    if (!response.ok) {
      const data = await response.json().catch(() => null);
      showFormMessage(productFormMessage, getBackendErrorMessage(data, translations[lang]["admin.genericError"]));
      return;
    }

    // Sukses (201 untuk tambah baru, 200 untuk edit) - tutup dialog, lalu
    // ambil ulang daftar produk dari server alih-alih menyisipkan/mengubah
    // kartu secara manual, supaya DOM selalu sinkron dengan sumber kebenaran
    // (prinsip yang sama seperti loadMenu() dipakai di banyak tempat lain).
    productDialog.close();
    loadMenu();
  } catch (error) {
    console.error("Gagal menghubungi server saat menyimpan produk:", error);
    showFormMessage(productFormMessage, translations[lang]["admin.genericError"]);
  } finally {
    productSubmitBtn.disabled = false;
  }
});

// ----------------------------------------------------------
// 9g. HAPUS PRODUK (ADMIN)
// ----------------------------------------------------------
// confirm() bawaan browser dipakai di sini (bukan dialog kustom) - ini aksi
// admin dengan cakupan minimal, bukan alur yang perlu UX halus. Begitu juga
// alert() di bawah untuk menampilkan error: tidak ada form/dialog yang
// sedang terbuka di titik ini (tombol Hapus ada langsung di kartu menu),
// jadi tidak ada tempat #form-message lain yang lebih pas untuk menaruhnya.
async function handleDeleteProduct(productId) {
  const lang = document.documentElement.lang;
  const product = productsById.get(productId);
  const confirmText = translations[lang]["admin.deleteConfirm"] + (product ? ` (${product.name})` : "");
  if (!confirm(confirmText)) return;

  try {
    const response = await fetch(`${API_BASE_URL}/api/products/${productId}`, {
      method: "DELETE",
      credentials: "include",
    });

    if (handleAdminAuthError(response, (msg) => alert(msg))) return;

    if (!response.ok) {
      const data = await response.json().catch(() => null);
      alert(getBackendErrorMessage(data, translations[lang]["admin.genericError"]));
      return;
    }

    // Sukses = 204 No Content - TIDAK ADA body sama sekali untuk di-parse di
    // response ini (beda dari POST/PUT di atas yang membalas JSON). Langsung
    // ambil ulang daftar produk dari server, sama seperti pola sukses
    // create/edit di atas.
    loadMenu();
  } catch (error) {
    console.error("Gagal menghubungi server saat menghapus produk:", error);
    alert(translations[lang]["admin.genericError"]);
  }
}

// Cek status login begitu halaman dimuat - sejajar dengan pemanggilan
// loadMenu() di bagian 3c. Diletakkan di baris paling akhir file supaya
// SEMUA fungsi & elemen yang dipakainya di atas (renderAuthUI, loadMenu,
// dst) sudah pasti selesai didefinisikan lebih dulu.
checkAuthState();
