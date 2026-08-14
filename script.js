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
const menuCards = document.querySelectorAll(".menu-card");

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
menuCards.forEach((card) => {
  const decreaseBtn = card.querySelector(".qty-decrease");
  const increaseBtn = card.querySelector(".qty-increase");

  decreaseBtn.addEventListener("click", () => changeCardQty(card, -1));
  increaseBtn.addEventListener("click", () => changeCardQty(card, 1));
});

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

// Tampilkan kondisi awal (keranjang kosong, tombol checkout nonaktif)
// saat halaman pertama kali dimuat.
updateCartSummary();

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

    "backToTop.aria": "Back to top",
  },
};

const langButtons = document.querySelectorAll(".lang-btn");
const i18nElements = document.querySelectorAll("[data-i18n]");
// Beberapa elemen (misalnya tombol +/- kuantitas keranjang) tidak punya teks
// biasa untuk diganti innerHTML-nya - teksnya justru disimpan di atribut
// aria-label supaya terbaca oleh screen reader (tombolnya sendiri hanya
// berisi simbol "−"/"+"). Elemen seperti ini diberi atribut data-i18n-aria
// sebagai pasangan dari data-i18n, supaya tetap ikut berganti bahasa.
const i18nAriaElements = document.querySelectorAll("[data-i18n-aria]");

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
  i18nElements.forEach((el) => {
    const key = el.getAttribute("data-i18n");
    const text = translations[lang][key];
    if (text !== undefined) el.innerHTML = text;
  });

  // Sama seperti di atas, tapi hasilnya dipasang ke atribut aria-label,
  // bukan innerHTML (lihat komentar pada deklarasi i18nAriaElements).
  i18nAriaElements.forEach((el) => {
    const key = el.getAttribute("data-i18n-aria");
    const text = translations[lang][key];
    if (text !== undefined) el.setAttribute("aria-label", text);
  });

  langButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.lang === lang));
  document.documentElement.lang = lang;
  setStoredLang(lang);
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
