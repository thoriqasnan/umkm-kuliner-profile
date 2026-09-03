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
// Sumber kebenaran cart adalah Map yang dikunci dengan productId. DOM kartu
// menu hanya menampilkan state tersebut, sehingga render ulang loadMenu()
// tidak menghapus quantity/catatan yang sudah dipilih pelanggan.
const WHATSAPP_NUMBER = "6281325132360";
const GUEST_CART_STORAGE_KEY = "umkm-cart:v1";
const PENDING_CART_MERGE_STORAGE_KEY = "umkm-cart-merge:v1";
const MAX_CART_QUANTITY = 99;
const MAX_CART_NOTE_LENGTH = 200;
const cartItems = new Map(); // Map<productId, { quantity, note }>
let cartAuthority = "unknown";
let cartEpoch = 0;
let authenticatedCartUserId = null;
let cartHasUnsyncedChanges = false;
let cartAuthCheckGeneration = 0;
const cartWriteStates = new Map();

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

// localStorage bisa gagal (mis. storage diblokir/private mode), jadi semua
// akses dibungkus try/catch. Cart tetap berfungsi di memori untuk tab ini.
function serializeCartItems(itemsMap) {
  return Array.from(itemsMap, ([productId, item]) => ({
    productId,
    quantity: item.quantity,
    note: item.note,
  }));
}

function persistGuestCart() {
  if (cartAuthority !== "guest") return;

  try {
    localStorage.setItem(GUEST_CART_STORAGE_KEY, JSON.stringify({ items: serializeCartItems(cartItems) }));
  } catch (error) {
    // Penyimpanan persisten opsional; jangan rusak sesi cart yang sedang aktif.
  }
}

function readGuestCartSnapshot() {
  const snapshot = new Map();
  let storedValue;
  try {
    storedValue = localStorage.getItem(GUEST_CART_STORAGE_KEY);
  } catch (error) {
    return snapshot;
  }

  if (storedValue === null) return snapshot;

  let parsed;
  try {
    parsed = JSON.parse(storedValue);
  } catch (error) {
    try { localStorage.setItem(GUEST_CART_STORAGE_KEY, JSON.stringify({ items: [] })); } catch (storageError) {}
    return snapshot;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || !Array.isArray(parsed.items)) {
    try { localStorage.setItem(GUEST_CART_STORAGE_KEY, JSON.stringify({ items: [] })); } catch (storageError) {}
    return snapshot;
  }

  let wasSanitized = false;
  parsed.items.forEach((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      wasSanitized = true;
      return;
    }

    const { productId, quantity, note } = item;
    if (
      !Number.isInteger(productId) ||
      productId <= 0 ||
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > MAX_CART_QUANTITY ||
      typeof note !== "string" ||
      note.length > MAX_CART_NOTE_LENGTH
    ) {
      wasSanitized = true;
      return;
    }

    if (snapshot.has(productId)) wasSanitized = true;
    snapshot.set(productId, { quantity, note });
  });

  if (wasSanitized) {
    try { localStorage.setItem(GUEST_CART_STORAGE_KEY, JSON.stringify({ items: serializeCartItems(snapshot) })); } catch (error) {}
  }
  return snapshot;
}

const initialGuestCartSnapshot = readGuestCartSnapshot();

function clearGuestCartStorage() {
  try { localStorage.removeItem(GUEST_CART_STORAGE_KEY); } catch (error) {}
}

function readPendingCartMerge() {
  try {
    const value = JSON.parse(localStorage.getItem(PENDING_CART_MERGE_STORAGE_KEY));
    const validKind = value && (value.kind === "unbound" || value.kind === "bound");
    const validUser = value && value.kind === "bound" && Number.isInteger(value.userId) && value.userId > 0;
    const validEmail = value && value.kind === "unbound" && typeof value.loginEmail === "string" && value.loginEmail.length > 0;
    if (!validKind || (!validUser && !validEmail) ||
        typeof value.mergeId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.mergeId)) {
      clearPendingCartMerge();
      return null;
    }
    const items = serializeCartItems(normalizeCartItems(value.items));
    if (items.length > 100) throw new Error("Pending merge terlalu besar");
    return value.kind === "bound"
      ? { kind: "bound", userId: value.userId, mergeId: value.mergeId, items }
      : { kind: "unbound", loginEmail: value.loginEmail.toLowerCase(), mergeId: value.mergeId, items };
  } catch (error) {
    clearPendingCartMerge();
    return null;
  }
}

function writePendingCartMerge(pending) {
  try {
    localStorage.setItem(PENDING_CART_MERGE_STORAGE_KEY, JSON.stringify(pending));
    return true;
  } catch (error) {
    return false;
  }
}

function clearPendingCartMerge() {
  try { localStorage.removeItem(PENDING_CART_MERGE_STORAGE_KEY); } catch (error) {}
}

function createCartMergeId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// Ubah angka biasa jadi format Rupiah ala Indonesia, misal 20000 -> "Rp 20.000".
// toLocaleString("id-ID") otomatis memberi titik pemisah ribuan, jadi hasilnya
// konsisten dengan harga yang sudah ditulis manual di tiap menu-card.
function formatRupiah(amount) {
  return "Rp " + amount.toLocaleString("id-ID");
}

function getCartItem(productId) {
  return cartItems.get(productId) || { quantity: 0, note: "" };
}

function normalizeCartItems(items) {
  if (!Array.isArray(items)) throw new Error("Respons cart tidak valid");
  const normalized = new Map();
  items.forEach((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item) ||
        !Number.isSafeInteger(item.productId) || item.productId <= 0 || normalized.has(item.productId) ||
        !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > MAX_CART_QUANTITY ||
        typeof item.note !== "string" || item.note.length > MAX_CART_NOTE_LENGTH) {
      throw new Error("Respons cart tidak valid");
    }
    normalized.set(item.productId, { quantity: item.quantity, note: item.note });
  });
  return normalized;
}

function replaceCartItems(items) {
  const normalized = items instanceof Map ? new Map(items) : normalizeCartItems(items);
  cartItems.clear();
  normalized.forEach((item, productId) => cartItems.set(productId, { ...item }));
  renderMenuCardQuantities();
  updateCartSummary();
  if (cartPanel.open) renderCartPanel();
}

function setCartAuthority(nextAuthority, userId = null) {
  if (cartAuthority !== nextAuthority || authenticatedCartUserId !== userId) {
    cartEpoch += 1;
    cartWriteStates.forEach((state) => {
      if (state.timer) clearTimeout(state.timer);
    });
    cartWriteStates.clear();
  }
  cartAuthority = nextAuthority;
  authenticatedCartUserId = nextAuthority === "authenticated" ? userId : null;
  updateCartInteractionState();
}

function updateCartInteractionState() {
  const mutationAllowed = cartAuthority === "guest" || cartAuthority === "authenticated";
  document.querySelectorAll(".cart-controls button, .cart-panel-item-note").forEach((control) => {
    control.disabled = !mutationAllowed;
  });
  updateCartSummary();
}

function showCartPersistenceError() {
  const isEnglish = document.documentElement.lang === "en";
  cartStatus.textContent = isEnglish
    ? "Cart changes could not be saved. Checkout is paused; please try again."
    : "Perubahan keranjang belum dapat disimpan. Checkout dijeda; silakan coba lagi.";
  showAuthStatus("auth.genericError");
}

function renderMenuCardQuantities() {
  menuCards.forEach((card) => {
    const productId = Number(card.dataset.productId);
    card.querySelector(".qty-value").textContent = getCartItem(productId).quantity;
  });
}

// Hitung ulang total item & total harga dari SEMUA card (termasuk yang sedang
// disembunyikan filter), lalu perbarui tampilan bar keranjang di bawah layar.
// Dipanggil setiap kali user menekan tombol +/- di salah satu card.
function updateCartSummary() {
  let totalItems = 0;
  let totalPrice = 0;

  cartItems.forEach((item, productId) => {
    const product = productsById.get(productId);
    if (!product) return;
    totalItems += item.quantity;
    totalPrice += item.quantity * product.price;
  });

  cartCountEl.textContent = totalItems;
  cartTotalEl.textContent = formatRupiah(totalPrice);

  // Keranjang kosong -> tombol checkout dimatikan (disabled) supaya tidak
  // bisa mengirim pesanan kosong ke WhatsApp, dan pesan hint ditampilkan.
  const isEmpty = totalItems === 0;
  const persistenceUnsafe = !["guest", "authenticated"].includes(cartAuthority) ||
    (cartAuthority === "authenticated" && cartHasUnsyncedChanges);
  cartCheckoutBtn.disabled = isEmpty || persistenceUnsafe;
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

// Ubah quantity berdasarkan productId, bukan referensi DOM kartu. Nilai 0
// menghapus item; batas 99 disamakan dengan kontrak backend fase berikutnya.
function changeCartQuantity(productId, delta) {
  if (!productsById.has(productId) || !["guest", "authenticated"].includes(cartAuthority)) return;

  const currentItem = getCartItem(productId);
  const nextQuantity = Math.min(MAX_CART_QUANTITY, Math.max(0, currentItem.quantity + delta));
  if (nextQuantity === currentItem.quantity) return;

  if (nextQuantity === 0) cartItems.delete(productId);
  else cartItems.set(productId, { quantity: nextQuantity, note: currentItem.note });

  if (cartAuthority === "guest") persistGuestCart();
  else scheduleAuthenticatedCartWrite(productId);
  renderMenuCardQuantities();
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
    const productId = Number(card.dataset.productId);
    const decreaseBtn = card.querySelector(".qty-decrease");
    const increaseBtn = card.querySelector(".qty-increase");

    decreaseBtn.addEventListener("click", () => changeCartQuantity(productId, -1));
    increaseBtn.addEventListener("click", () => changeCartQuantity(productId, 1));
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
  productsById.forEach((product, productId) => {
    const item = cartItems.get(productId);
    if (!item) return;

    const name = translations[document.documentElement.lang][`product.${product.slug}.name`] || product.name;
    const subtotal = item.quantity * product.price;
    totalPrice += subtotal;
    itemNumber += 1;

    lines.push(`${itemNumber}. ${name} x${item.quantity} = ${formatRupiah(subtotal)}`);

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
    const note = item.note.trim();
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
let productsLoadState = "loading"; // "loading" | "success" | "empty" | "error" - status presentasi produk
const menuGrid = document.getElementById("menuGrid");
const menuStatus = document.getElementById("menuStatus");
let menuStatusTimer = null;

async function readCartApiResponse(response) {
  if (!response.ok) {
    const error = new Error(`Cart API gagal dengan status ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.status === 204 ? null : response.json();
}

async function fetchAuthenticatedCart() {
  const response = await fetch(`${API_BASE_URL}/api/cart`, { credentials: "include" });
  const data = await readCartApiResponse(response);
  if (!data || data.status !== "success") throw new Error("Respons cart tidak valid");
  return normalizeCartItems(data.items);
}

async function putAuthenticatedCartItem(productId, item) {
  const response = await fetch(`${API_BASE_URL}/api/cart/items/${productId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ quantity: item.quantity, note: item.note }),
  });
  return readCartApiResponse(response);
}

async function deleteAuthenticatedCartItem(productId) {
  const response = await fetch(`${API_BASE_URL}/api/cart/items/${productId}`, {
    method: "DELETE",
    credentials: "include",
  });
  return readCartApiResponse(response);
}

async function mergeGuestCart(mergeId, items) {
  const response = await fetch(`${API_BASE_URL}/api/cart/merge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ mergeId, items }),
  });
  const data = await readCartApiResponse(response);
  if (!data || data.status !== "success" || !Array.isArray(data.skippedProductIds) ||
      typeof data.alreadyMerged !== "boolean") throw new Error("Respons merge cart tidak valid");
  return { ...data, normalizedItems: normalizeCartItems(data.items) };
}

async function recoverAuthenticatedCart(expectedEpoch, expectedUserId) {
  if (cartEpoch !== expectedEpoch || authenticatedCartUserId !== expectedUserId) return;
  setCartAuthority("authenticated-loading");
  const recoveryEpoch = cartEpoch;
  try {
    const canonical = await fetchAuthenticatedCart();
    if (cartEpoch !== recoveryEpoch || !currentUser || currentUser.id !== expectedUserId) return;
    replaceCartItems(canonical);
    cartHasUnsyncedChanges = false;
    setCartAuthority("authenticated", expectedUserId);
    hideAuthStatus();
  } catch (error) {
    if (cartEpoch === recoveryEpoch && currentUser && currentUser.id === expectedUserId) {
      cartHasUnsyncedChanges = true;
      setCartAuthority("indeterminate");
      showCartPersistenceError();
    }
  }
}

async function runAuthenticatedCartWriter(productId, state) {
  if (state.running) return;
  state.running = true;
  const expectedEpoch = cartEpoch;
  const expectedUserId = authenticatedCartUserId;
  try {
    while (["authenticated", "logout-preparing"].includes(cartAuthority) && cartEpoch === expectedEpoch &&
           authenticatedCartUserId === expectedUserId && state.persistedVersion < state.version) {
      const version = state.version;
      const desiredItem = cartItems.get(productId);
      if (desiredItem) await putAuthenticatedCartItem(productId, desiredItem);
      else await deleteAuthenticatedCartItem(productId);
      if (cartEpoch !== expectedEpoch || authenticatedCartUserId !== expectedUserId) return;
      state.persistedVersion = version;
    }
    if (cartEpoch === expectedEpoch && authenticatedCartUserId === expectedUserId) {
      cartHasUnsyncedChanges = Array.from(cartWriteStates.values()).some((entry) => entry.persistedVersion < entry.version);
      updateCartInteractionState();
    }
  } catch (error) {
    if (cartEpoch !== expectedEpoch || authenticatedCartUserId !== expectedUserId) return;
    cartHasUnsyncedChanges = true;
    state.failed = true;
    showCartPersistenceError();
    if (error.status === 401) {
      setCartAuthority("indeterminate");
      await checkAuthState({ reason: "operation-401" });
    } else {
      await recoverAuthenticatedCart(expectedEpoch, expectedUserId);
    }
  } finally {
    state.running = false;
  }
}

function startAuthenticatedCartWriter(productId, state) {
  if (!state.promise || !state.running) {
    state.promise = runAuthenticatedCartWriter(productId, state);
  }
  return state.promise;
}

function scheduleAuthenticatedCartWrite(productId, debounce = false) {
  if (cartAuthority !== "authenticated") return;
  let state = cartWriteStates.get(productId);
  if (!state) {
    state = { version: 0, persistedVersion: 0, running: false, timer: null, promise: null, failed: false };
    cartWriteStates.set(productId, state);
  }
  state.version += 1;
  cartHasUnsyncedChanges = true;
  updateCartInteractionState();
  if (state.timer) clearTimeout(state.timer);
  state.timer = null;
  if (debounce) state.timer = setTimeout(() => { state.timer = null; startAuthenticatedCartWriter(productId, state); }, 450);
  else startAuthenticatedCartWriter(productId, state);
}

function flushAuthenticatedCartWrite(productId) {
  const state = cartWriteStates.get(productId);
  if (!state || !["authenticated", "logout-preparing"].includes(cartAuthority)) return;
  if (state.timer) clearTimeout(state.timer);
  state.timer = null;
  startAuthenticatedCartWriter(productId, state);
}

async function drainAuthenticatedCartWritesForLogout() {
  if (cartAuthority !== "authenticated") return false;

  // Kunci interaksi tanpa mengganti epoch/user: writer yang sudah berjalan
  // harus tetap sah sampai drain selesai.
  cartAuthority = "logout-preparing";
  updateCartInteractionState();
  const states = Array.from(cartWriteStates.entries());
  states.forEach(([productId, state]) => {
    if (state.timer) clearTimeout(state.timer);
    state.timer = null;
    startAuthenticatedCartWriter(productId, state);
  });
  await Promise.all(states.map(([, state]) => state.promise).filter(Boolean));

  const drainFailed = states.some(([, state]) => state.failed || state.persistedVersion < state.version) ||
    cartHasUnsyncedChanges || !["authenticated", "logout-preparing"].includes(cartAuthority);
  if (drainFailed) {
    if (cartAuthority === "logout-preparing") cartAuthority = "authenticated";
    updateCartInteractionState();
    showCartPersistenceError();
    return false;
  }
  return true;
}

function showMenuStatus(key, type = "loading", autoHide = false) {
  if (menuStatusTimer) clearTimeout(menuStatusTimer);
  menuStatusTimer = null;
  menuStatus.dataset.i18n = key;
  menuStatus.textContent = translations[document.documentElement.lang][key];
  menuStatus.className = `menu-status ${type}`;
  menuStatus.setAttribute("role", type === "error" ? "alert" : "status");

  if (autoHide) {
    menuStatusTimer = setTimeout(() => {
      if (document.activeElement === menuStatus && !adminAddProductBtn.classList.contains("hide")) {
        adminAddProductBtn.focus();
      }
      menuStatus.classList.add("hide");
      menuStatus.removeAttribute("data-i18n");
      menuStatus.textContent = "";
      menuStatusTimer = null;
    }, 5000);
  }
}

function hideMenuStatus() {
  if (menuStatusTimer) clearTimeout(menuStatusTimer);
  menuStatusTimer = null;
  menuStatus.className = "menu-status hide";
  menuStatus.removeAttribute("data-i18n");
  menuStatus.textContent = "";
  menuStatus.setAttribute("role", "status");
}

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
    deleteBtn.addEventListener("click", () => handleDeleteProduct(product.id, deleteBtn));

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
  productsLoadState = "loading";
  menuGrid.setAttribute("aria-busy", "true");
  showMenuStatus("menu.loading", "loading");
  queueMicrotask(updateAdminProductTotal);
  try {
    const response = await fetch(`${API_BASE_URL}/api/products`);
    if (!response.ok) throw new Error(`Request gagal dengan status ${response.status}`);

    const products = await response.json();

    // Disimpan supaya openProductDialog() bisa mengisi form edit dengan data
    // produk yang lengkap (termasuk field yang tidak ditampilkan di kartu,
    // seperti width/height/srcset gambar) tanpa perlu fetch ulang satu-satu
    // per produk saat tombol Edit diklik.
    productsById = new Map(products.map((product) => [product.id, product]));
    // Item cart valid yang tidak ada di snapshot ini sengaja tetap disimpan.
    // Semua renderer di bawah hanya memakai item yang punya product terbaru,
    // jadi item tersebut dormant tanpa membawa nama/harga stale dan dapat
    // muncul kembali bila snapshot produk berikutnya memuat productId-nya.
    productsLoadState = products.length === 0 ? "empty" : "success";

    menuGrid.innerHTML = "";
    products.forEach((product) => {
      menuGrid.appendChild(createMenuCardElement(product));
    });

    menuCards = document.querySelectorAll(".menu-card");
    wireMenuCardQtyButtons();
    renderMenuCardQuantities();
    updateCartInteractionState();
    applyLanguage(document.documentElement.lang);
    updateAdminProductTotal();
    if (productsLoadState === "empty") showMenuStatus("menu.empty", "empty");
    else hideMenuStatus();
    return true;
  } catch (error) {
    productsLoadState = "error";
    updateAdminProductTotal();
    // Error TIDAK disembunyikan dari user - ditampilkan pesan sederhana di
    // area menu (bukan crash/blank), sekaligus dicatat ke console supaya
    // developer bisa lihat detail error aslinya saat debugging.
    console.error("Gagal memuat menu dari backend:", error);
    showMenuStatus("menu.loadError", "error");
    return false;
  } finally {
    menuGrid.setAttribute("aria-busy", "false");
  }
}

// Ambil & render menu saat halaman pertama kali dimuat. Menggantikan
// pemanggilan updateCartSummary() yang dulu ada di sini langsung - sekarang
// updateCartSummary() dipanggil DARI DALAM loadMenu() (lihat di atas),
// setelah kartu-kartu produk selesai dirender, bukan lagi dipanggil di sini
// saat kartu belum tentu ada.
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
// SATU productId. Dipisah jadi fungsi sendiri supaya renderCartPanel() di
// bawah bisa memanggilnya HANYA untuk item yang baru pertama kali masuk
// keranjang, bukan untuk semua item setiap kali dirender ulang.
function createCartPanelItem(productId) {
  const isEnglish = document.documentElement.lang === "en";
  const product = productsById.get(productId);
  const name = translations[document.documentElement.lang][`product.${product.slug}.name`] || product.name;

  const item = document.createElement("li");
  item.className = "cart-panel-item";
  item.dataset.productId = productId;

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

  // Tombol +/- di sini memanggil mutasi model yang SAMA dengan tombol di
  // grid menu utama. Handler hanya menyimpan productId, bukan DOM card lama.
  const controls = document.createElement("div");
  controls.className = "cart-controls";
  controls.setAttribute("role", "group");
  controls.setAttribute("aria-label", isEnglish ? "Order quantity" : "Jumlah pesanan");

  const decreaseBtn = document.createElement("button");
  decreaseBtn.type = "button";
  decreaseBtn.className = "qty-btn qty-decrease";
  decreaseBtn.setAttribute("aria-label", isEnglish ? "Decrease quantity" : "Kurangi jumlah");
  decreaseBtn.innerHTML = "&minus;";
  decreaseBtn.addEventListener("click", () => changeCartQuantity(productId, -1));

  const qtyEl = document.createElement("span");
  qtyEl.className = "qty-value";
  qtyEl.setAttribute("aria-live", "polite");

  const increaseBtn = document.createElement("button");
  increaseBtn.type = "button";
  increaseBtn.className = "qty-btn qty-increase";
  increaseBtn.setAttribute("aria-label", isEnglish ? "Increase quantity" : "Tambah jumlah");
  increaseBtn.innerHTML = "+";
  increaseBtn.addEventListener("click", () => changeCartQuantity(productId, 1));

  controls.append(decreaseBtn, qtyEl, increaseBtn);

  // Catatan per item (misal "tidak pedas") disimpan di cartItems bersama
  // quantity, lalu langsung dipersist ke guest localStorage.
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
  noteInput.maxLength = MAX_CART_NOTE_LENGTH;
  noteInput.className = "cart-panel-item-note";
  noteInput.value = getCartItem(productId).note;
  noteInput.setAttribute("aria-label", (isEnglish ? "Note for " : "Catatan untuk ") + name);
  noteInput.placeholder = isEnglish ? "Add a note (optional)" : "Tambahkan catatan (opsional)";
  noteInput.addEventListener("input", (event) => {
    if (!["guest", "authenticated"].includes(cartAuthority)) return;
    const cartItem = cartItems.get(productId);
    if (!cartItem) return;
    cartItems.set(productId, { quantity: cartItem.quantity, note: event.target.value });
    if (cartAuthority === "guest") persistGuestCart();
    else scheduleAuthenticatedCartWrite(productId, true);
  });
  noteInput.addEventListener("blur", () => flushAuthenticatedCartWrite(productId));
  noteInput.addEventListener("change", () => flushAuthenticatedCartWrite(productId));

  item.append(info, controls, noteInput);
  return item;
}

// Panel membaca cartItems dan menggabungkannya dengan productsById. Filter
// kategori tidak berpengaruh karena panel tidak bergantung pada card visible.
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
  const cartProductIds = Array.from(productsById.keys()).filter((productId) => cartItems.has(productId));

  const isEmpty = cartProductIds.length === 0;
  cartPanelEmpty.classList.toggle("hide", !isEmpty);
  cartPanelList.classList.toggle("hide", isEmpty);

  if (isEmpty) {
    cartPanelList.innerHTML = "";
    return; // keranjang kosong -> cukup tampilkan pesan kosong di atas
  }

  // (1) Buang <li> untuk item yang qty-nya sudah jadi 0 (dikeluarkan dari keranjang).
  Array.from(cartPanelList.children).forEach((li) => {
    const productId = Number(li.dataset.productId);
    if (!cartProductIds.includes(productId)) li.remove();
  });

  // (2) Untuk tiap item yang masih/baru ada di keranjang: kalau <li>-nya
  // sudah ada, cukup perbarui teks qty & subtotal-nya di tempat. Kalau
  // belum ada (item baru), buat satu <li> baru dan sisipkan di posisi yang
  // sesuai urutan menu (bukan selalu ditambah di paling bawah), supaya
  // urutan tampilannya tetap rapi mengikuti urutan di grid menu.
  cartProductIds.forEach((productId, desiredIndex) => {
    const product = productsById.get(productId);
    const cartItem = cartItems.get(productId);
    const name = translations[document.documentElement.lang][`product.${product.slug}.name`] || product.name;
    const subtotal = cartItem.quantity * product.price;

    let li = cartPanelList.querySelector(`[data-product-id="${productId}"]`);
    if (!li) {
      li = createCartPanelItem(productId);
    }
    // Pindahkan hanya bila posisinya memang berubah. Pada update quantity
    // biasa node tidak disentuh, sehingga fokus tombol/textarea tetap aman.
    const itemAtDesiredIndex = cartPanelList.children[desiredIndex];
    if (itemAtDesiredIndex !== li) cartPanelList.insertBefore(li, itemAtDesiredIndex || null);

    li.querySelector(".cart-panel-item-name").textContent = name;
    li.querySelector(".qty-value").textContent = cartItem.quantity;
    li.querySelector(".cart-panel-item-subtotal").textContent = formatRupiah(subtotal);

    const isEnglish = document.documentElement.lang === "en";
    const controls = li.querySelector(".cart-controls");
    controls.setAttribute("aria-label", isEnglish ? "Order quantity" : "Jumlah pesanan");
    controls.querySelector(".qty-decrease").setAttribute("aria-label", isEnglish ? "Decrease quantity" : "Kurangi jumlah");
    controls.querySelector(".qty-increase").setAttribute("aria-label", isEnglish ? "Increase quantity" : "Tambah jumlah");

    const noteInput = li.querySelector(".cart-panel-item-note");
    noteInput.setAttribute("aria-label", (isEnglish ? "Note for " : "Catatan untuk ") + name);
    noteInput.placeholder = isEnglish ? "Add a note (optional)" : "Tambahkan catatan (opsional)";
    if (document.activeElement !== noteInput) noteInput.value = cartItem.note;
  });
  updateCartInteractionState();
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
    "menu.loadError": "Menu gagal dimuat. Silakan coba lagi.",
    "menu.empty": "Belum ada produk.",
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
    "auth.loginLoading": "Sedang masuk...",
    "auth.registerLoading": "Sedang mendaftar...",
    "auth.logoutLoading": "Sedang keluar...",
    "auth.noAccount": "Belum punya akun?",
    "auth.haveAccount": "Sudah punya akun?",
    "auth.switchToRegister": "Daftar di sini",
    "auth.switchToLogin": "Masuk di sini",
    "auth.registerSuccess": "Akun berhasil dibuat, silakan masuk.",
    "auth.invalidCredentials": "Email atau kata sandi salah.",
    "auth.invalidInput": "Periksa kembali email dan kata sandi kamu.",
    "auth.emailExists": "Email sudah terdaftar. Silakan masuk.",
    "auth.rateLimited": "Terlalu banyak percobaan. Silakan coba lagi nanti.",
    "auth.sessionExpired": "Sesi kamu sudah berakhir, silakan masuk lagi.",
    "auth.genericError": "Permintaan gagal. Silakan coba lagi.",
    "auth.verifyError": "Status login tidak dapat diverifikasi. Silakan coba lagi.",
    "auth.logoutError": "Gagal keluar. Kamu masih login, silakan coba lagi.",

    "admin.dashboardEntry": "Dashboard",
    "admin.dashboardLabel": "Area Admin",
    "admin.dashboardTitle": "Admin Dashboard",
    "admin.signedInAs": "Login sebagai",
    "admin.navigationLabel": "Navigasi admin",
    "admin.dashboardNav": "Dashboard",
    "admin.productsNav": "Produk",
    "admin.viewWebsiteNav": "Lihat Website",
    "admin.analyticsNav": "Analitik",
    "admin.analyticsTitle": "Analitik Penjualan",
    "admin.analyticsDesc": "Ringkasan performa penjualan yang didukung layanan analitik.",
    "admin.analyticsRevenue": "Total Pendapatan",
    "admin.analyticsOrders": "Pesanan Unik",
    "admin.analyticsQuantity": "Jumlah Terjual",
    "admin.analyticsAOV": "Rata-rata Nilai Pesanan",
    "admin.analyticsProductPerfTitle": "Performa Produk",
    "admin.analyticsTableCaption": "Tabel performa produk berdasarkan jumlah terjual dan pendapatan",
    "admin.analyticsColProduct": "Produk",
    "admin.analyticsColQuantity": "Jumlah Terjual",
    "admin.analyticsColRevenue": "Pendapatan",
    "admin.analyticsCategoryTitle": "Pendapatan per Kategori",
    "admin.analyticsLoading": "Memuat data analitik...",
    "admin.analyticsError": "Gagal memuat data analitik. Silakan coba lagi.",
    "admin.analyticsProductsEmpty": "Belum ada data performa produk.",
    "admin.analyticsCategoriesEmpty": "Belum ada data kategori.",
    "admin.salesTrendTitle": "Tren Penjualan",
    "admin.salesTrendStart": "Tanggal Mulai",
    "admin.salesTrendEnd": "Tanggal Akhir",
    "admin.salesTrendApply": "Terapkan",
    "admin.salesTrendTotal": "Total Penjualan",
    "admin.salesTrendHigh": "Hari Penjualan Tertinggi",
    "admin.salesTrendLow": "Hari Penjualan Terendah",
    "admin.salesTrendDate": "Tanggal",
    "admin.salesTrendTableCaption": "Data penjualan harian untuk rentang terpilih",
    "admin.salesTrendLoading": "Memuat tren penjualan...",
    "admin.salesTrendError": "Tren penjualan tidak dapat dimuat. Silakan coba lagi.",
    "admin.salesTrendEmpty": "Tidak ada penjualan pada periode terpilih.",
    "admin.salesTrendInvalid": "Pilih rentang tanggal yang valid.",
    "admin.forecastTitle": "Prediksi Permintaan Besok",
    "admin.forecastLabel": "FORECAST BESOK",
    "admin.forecastLoading": "Memuat prediksi permintaan...",
    "admin.forecastEstimate": "Estimasi total item yang akan terjual besok",
    "admin.forecastQuantity": "≈ {value} unit",
    "admin.forecastHistory": "KONTEKS HISTORIS",
    "admin.forecast7Days": "7 HARI TERAKHIR",
    "admin.forecast28Days": "28 HARI TERAKHIR",
    "admin.forecastAverage": "Rata-rata {value} unit",
    "admin.forecastAbove": "↑ {value}% di atas rata-rata",
    "admin.forecastBelow": "↓ {value}% di bawah rata-rata",
    "admin.forecastClose": "Mendekati rata-rata",
    "admin.forecastUnavailable": "Perbandingan tidak tersedia",
    "admin.forecastContext": "KONTEKS FORECAST",
    "admin.forecastDataThrough": "Data historis",
    "admin.forecastThroughPrefix": "s.d. {date}",
    "admin.forecastDateLabel": "Tanggal prediksi",
    "admin.forecastHorizon": "Horizon",
    "admin.forecastOneDay": "1 hari",
    "admin.forecastFilterNote": "Forecast selalu menggunakan histori terbaru yang tersedia dan tidak berubah mengikuti filter tanggal analytics.",
    "admin.forecastDisclaimer": "Prediksi dibuat berdasarkan pola historis transaksi. Hasil aktual dapat berbeda, terutama saat promosi, event, atau lonjakan permintaan yang tidak biasa.",
    "admin.forecastAbout": "Tentang prediksi ini",
    "admin.forecastAboutBody": "Model HistGradientBoosting memperkirakan total permintaan satu hari berikutnya dari pola kalender dan permintaan historis, termasuk fitur berbasis histori 7 dan 28 hari. Ini adalah estimasi; promosi, event, dan lonjakan tidak biasa mungkin lebih sulit diprediksi.",
    "admin.forecastErrorTitle": "Prediksi tidak dapat dimuat.",
    "admin.forecastErrorBody": "Layanan prediksi sementara tidak tersedia.",
    "admin.forecastRetry": "Coba Lagi",
    "admin.activePeriod": "Periode aktif",
    "admin.availablePeriod": "Data tersedia",
    "admin.calendarPrev": "Bulan sebelumnya",
    "admin.calendarNext": "Bulan berikutnya",
    "admin.calendarMonth": "Bulan",
    "admin.calendarYear": "Tahun",
    "admin.calendarOpen": "Buka kalender",
    "admin.chartExplore": "Jelajahi detail tanggal dengan tombol panah kiri dan kanan",
    "admin.totalProducts": "Total Produk",
    "admin.productsLoading": "Memuat...",
    "admin.productsUnavailable": "Tidak tersedia",
    "admin.currentRole": "Role Saat Ini",
    "admin.loggedInAs": "Login sebagai",
    "admin.addProductBtn": "+ Tambah Produk",
    "admin.addProductTitle": "Tambah Produk",
    "admin.editProductTitle": "Edit Produk",
    "admin.addProductSubmit": "Simpan Produk",
    "admin.editProductSubmit": "Simpan Perubahan",
    "admin.addProductLoading": "Menyimpan produk...",
    "admin.editProductLoading": "Menyimpan perubahan...",
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
    "admin.deleteLoading": "Menghapus...",
    "admin.deleteConfirm": "Yakin ingin menghapus produk ini?",
    "admin.addSuccess": "Produk berhasil ditambahkan.",
    "admin.editSuccess": "Produk berhasil diperbarui.",
    "admin.deleteSuccess": "Produk berhasil dihapus.",
    "admin.permissionDenied": "Kamu tidak punya izin untuk melakukan ini.",
    "admin.rateLimited": "Terlalu banyak percobaan, coba lagi nanti.",
    "admin.validationError": "Periksa kembali data produk yang diisi.",
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
    "menu.loadError": "Failed to load the menu. Please try again.",
    "menu.empty": "No products yet.",
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
    "auth.loginLoading": "Logging in...",
    "auth.registerLoading": "Registering...",
    "auth.logoutLoading": "Logging out...",
    "auth.noAccount": "Don't have an account?",
    "auth.haveAccount": "Already have an account?",
    "auth.switchToRegister": "Register here",
    "auth.switchToLogin": "Log in here",
    "auth.registerSuccess": "Account created successfully, please log in.",
    "auth.invalidCredentials": "The email or password is incorrect.",
    "auth.invalidInput": "Please check your email and password.",
    "auth.emailExists": "That email is already registered. Please log in.",
    "auth.rateLimited": "Too many attempts. Please try again later.",
    "auth.sessionExpired": "Your session has expired, please log in again.",
    "auth.genericError": "The request failed. Please try again.",
    "auth.verifyError": "Your sign-in status could not be verified. Please try again.",
    "auth.logoutError": "Log out failed. You are still signed in; please try again.",

    "admin.dashboardEntry": "Dashboard",
    "admin.dashboardLabel": "Admin Area",
    "admin.dashboardTitle": "Admin Dashboard",
    "admin.signedInAs": "Signed in as",
    "admin.navigationLabel": "Admin navigation",
    "admin.dashboardNav": "Dashboard",
    "admin.productsNav": "Products",
    "admin.viewWebsiteNav": "View Website",
    "admin.analyticsNav": "Analytics",
    "admin.analyticsTitle": "Sales Analytics",
    "admin.analyticsDesc": "Sales performance summary powered by the analytics service.",
    "admin.analyticsRevenue": "Total Revenue",
    "admin.analyticsOrders": "Unique Orders",
    "admin.analyticsQuantity": "Quantity Sold",
    "admin.analyticsAOV": "Average Order Value",
    "admin.analyticsProductPerfTitle": "Product Performance",
    "admin.analyticsTableCaption": "Table of product performance by quantity sold and revenue",
    "admin.analyticsColProduct": "Product",
    "admin.analyticsColQuantity": "Quantity Sold",
    "admin.analyticsColRevenue": "Revenue",
    "admin.analyticsCategoryTitle": "Revenue by Category",
    "admin.analyticsLoading": "Loading analytics data...",
    "admin.analyticsError": "Failed to load analytics data. Please try again.",
    "admin.analyticsProductsEmpty": "No product performance data yet.",
    "admin.analyticsCategoriesEmpty": "No category data yet.",
    "admin.salesTrendTitle": "Sales Trend",
    "admin.salesTrendStart": "Start Date",
    "admin.salesTrendEnd": "End Date",
    "admin.salesTrendApply": "Apply",
    "admin.salesTrendTotal": "Total Sales",
    "admin.salesTrendHigh": "Highest Sales Day",
    "admin.salesTrendLow": "Lowest Sales Day",
    "admin.salesTrendDate": "Date",
    "admin.salesTrendTableCaption": "Daily sales data for the selected range",
    "admin.salesTrendLoading": "Loading sales trend...",
    "admin.salesTrendError": "Unable to load sales trend. Please try again.",
    "admin.salesTrendEmpty": "No sales in selected period.",
    "admin.salesTrendInvalid": "Choose a valid date range.",
    "admin.forecastTitle": "Next-Day Demand Forecast",
    "admin.forecastLabel": "TOMORROW'S FORECAST",
    "admin.forecastLoading": "Loading demand forecast...",
    "admin.forecastEstimate": "Estimated total items expected to sell tomorrow",
    "admin.forecastQuantity": "≈ {value} units",
    "admin.forecastHistory": "HISTORICAL CONTEXT",
    "admin.forecast7Days": "LAST 7 DAYS",
    "admin.forecast28Days": "LAST 28 DAYS",
    "admin.forecastAverage": "Average {value} units",
    "admin.forecastAbove": "↑ {value}% above average",
    "admin.forecastBelow": "↓ {value}% below average",
    "admin.forecastClose": "Close to average",
    "admin.forecastUnavailable": "Comparison unavailable",
    "admin.forecastContext": "FORECAST CONTEXT",
    "admin.forecastDataThrough": "Historical data",
    "admin.forecastThroughPrefix": "through {date}",
    "admin.forecastDateLabel": "Forecast date",
    "admin.forecastHorizon": "Horizon",
    "admin.forecastOneDay": "1 day",
    "admin.forecastFilterNote": "The forecast always uses the latest available history and does not change with the Analytics date filter.",
    "admin.forecastDisclaimer": "The forecast is based on historical transaction patterns. Actual results may differ, especially during promotions, events, or unusual demand spikes.",
    "admin.forecastAbout": "About this forecast",
    "admin.forecastAboutBody": "The HistGradientBoosting model estimates next-day total demand from calendar patterns and historical demand, including features based on 7-day and 28-day history. It is an estimate; promotions, events, and unusual spikes may be harder to predict.",
    "admin.forecastErrorTitle": "The forecast could not be loaded.",
    "admin.forecastErrorBody": "The forecast service is temporarily unavailable.",
    "admin.forecastRetry": "Try Again",
    "admin.activePeriod": "Active period",
    "admin.availablePeriod": "Data available",
    "admin.calendarPrev": "Previous month",
    "admin.calendarNext": "Next month",
    "admin.calendarMonth": "Month",
    "admin.calendarYear": "Year",
    "admin.calendarOpen": "Open calendar",
    "admin.chartExplore": "Explore date details with the left and right arrow keys",
    "admin.totalProducts": "Total Products",
    "admin.productsLoading": "Loading...",
    "admin.productsUnavailable": "Unavailable",
    "admin.currentRole": "Current Role",
    "admin.loggedInAs": "Logged in as",
    "admin.addProductBtn": "+ Add Product",
    "admin.addProductTitle": "Add Product",
    "admin.editProductTitle": "Edit Product",
    "admin.addProductSubmit": "Save Product",
    "admin.editProductSubmit": "Save Changes",
    "admin.addProductLoading": "Saving product...",
    "admin.editProductLoading": "Saving changes...",
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
    "admin.deleteLoading": "Deleting...",
    "admin.deleteConfirm": "Are you sure you want to delete this product?",
    "admin.addSuccess": "Product added successfully.",
    "admin.editSuccess": "Product updated successfully.",
    "admin.deleteSuccess": "Product deleted successfully.",
    "admin.permissionDenied": "You don't have permission to do this.",
    "admin.rateLimited": "Too many attempts, please try again later.",
    "admin.validationError": "Please check the product information you entered.",
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
  queueMicrotask(updateAdminProductTotal);

  // Deskripsi produk (Phase 3E) tidak ikut ter-update lewat sweep [data-i18n]
  // di atas - lihat komentar lengkap di updateProductDescriptions() (bagian 9a)
  // dan di createMenuCardElement() (bagian 3c) untuk alasannya.
  updateProductDescriptions(lang);
  if (cartPanel.open) renderCartPanel();
}

langButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    applyLanguage(btn.dataset.lang);
    if (analyticsState && analyticsState.trend && analyticsState.trend.data) {
      renderSalesTrend(analyticsState.trend.data);
      renderAvailablePeriod();
      if (!startCalendar.calendar.hidden) renderCalendar(startCalendar);
      if (!endCalendar.calendar.hidden) renderCalendar(endCalendar);
    }
    if (analyticsState && analyticsState.forecast && analyticsState.forecast.data) renderForecast(analyticsState.forecast.data);
  });
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
const adminDashboardEntry = document.getElementById("adminDashboardEntry");
const adminDashboard = document.getElementById("adminDashboard");
const adminHeaderEmail = document.getElementById("adminHeaderEmail");
const adminCurrentRole = document.getElementById("adminCurrentRole");
const adminLoggedInEmail = document.getElementById("adminLoggedInEmail");
const adminTotalProducts = document.getElementById("adminTotalProducts");
const adminOverview = document.getElementById("adminOverview");
const adminAnalytics = document.getElementById("adminAnalytics");
const adminNavLinks = document.querySelectorAll(".admin-nav-link[data-admin-destination]");
const adminLogoutBtn = document.getElementById("adminLogoutBtn");

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
const authStatus = document.getElementById("authStatus");

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
function showFormMessage(el, text, type = "error", key = null) {
  el.textContent = text;
  el.classList.remove("hide", "error", "success");
  el.classList.add(type);
  el.setAttribute("role", type === "error" ? "alert" : "status");
  if (key) el.dataset.i18n = key;
  else el.removeAttribute("data-i18n");
}

function hideFormMessage(el) {
  el.classList.add("hide");
  el.textContent = "";
  el.removeAttribute("data-i18n");
  el.removeAttribute("role");
}

function showAuthStatus(key) {
  authStatus.dataset.i18n = key;
  authStatus.textContent = translations[document.documentElement.lang][key];
  authStatus.classList.remove("hide");
}

function hideAuthStatus() {
  authStatus.classList.add("hide");
  authStatus.removeAttribute("data-i18n");
  authStatus.textContent = "";
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
// 9a-2. ANALITIK ADMIN (Phase 4G-2 Integrasi API, Phase 4G-3 Visualisasi)
// ----------------------------------------------------------
// Tiga endpoint Node (bukan layanan Python di baliknya secara langsung - lihat
// lib/pythonAnalyticsClient.js di backend) dimuat lazy sekali per sesi admin,
// saat nav "Analitik" pertama kali diklik. Kegagalan satu bagian (summary/
// products/categories) TIDAK
// boleh menghapus bagian lain yang berhasil - karena itu tiga status
// independen (bukan satu status global seperti #menuStatus) dan tiga
// fetch terpisah lewat Promise.allSettled, bukan Promise.all.
const adminAnalyticsStatusEl = document.getElementById("adminAnalyticsStatus");
const adminAnalyticsRevenueEl = document.getElementById("adminAnalyticsRevenue");
const adminAnalyticsOrdersEl = document.getElementById("adminAnalyticsOrders");
const adminAnalyticsQuantityEl = document.getElementById("adminAnalyticsQuantity");
const adminAnalyticsAOVEl = document.getElementById("adminAnalyticsAOV");
const adminAnalyticsProductBodyEl = document.getElementById("adminAnalyticsProductBody");
const adminAnalyticsProductsStatusEl = document.getElementById("adminAnalyticsProductsStatus");
const adminAnalyticsCategoryChartEl = document.getElementById("adminAnalyticsCategoryChart");
const adminAnalyticsCategoriesStatusEl = document.getElementById("adminAnalyticsCategoriesStatus");
const adminSalesTrendFormEl = document.getElementById("adminSalesTrendForm");
const adminSalesTrendStartEl = document.getElementById("adminSalesTrendStartInput");
const adminSalesTrendEndEl = document.getElementById("adminSalesTrendEndInput");
const adminSalesTrendStatusEl = document.getElementById("adminSalesTrendStatus");
const adminSalesTrendRangeEl = document.getElementById("adminSalesTrendRange");
const adminSalesTrendRevenueEl = document.getElementById("adminSalesTrendRevenue");
const adminSalesTrendOrdersEl = document.getElementById("adminSalesTrendOrders");
const adminSalesTrendQuantityEl = document.getElementById("adminSalesTrendQuantity");
const adminSalesTrendAOVEl = document.getElementById("adminSalesTrendAOV");
const adminSalesTrendHighEl = document.getElementById("adminSalesTrendHigh");
const adminSalesTrendLowEl = document.getElementById("adminSalesTrendLow");
const adminSalesTrendChartEl = document.getElementById("adminSalesTrendChart");
const adminSalesTrendTooltipEl = document.getElementById("adminSalesTrendTooltip");
const adminSalesTrendTableBodyEl = document.getElementById("adminSalesTrendTableBody");
const adminAnalyticsAvailablePeriodEl = document.getElementById("adminAnalyticsAvailablePeriod");
const adminAnalyticsAppliedPeriodEl = document.getElementById("adminAnalyticsAppliedPeriod");
const adminSalesTrendApplyBtnEl = document.getElementById("adminSalesTrendApplyBtn");
const adminForecastStatusEl = document.getElementById("adminForecastStatus");
const adminForecastContentEl = document.getElementById("adminForecastContent");
const adminForecastErrorEl = document.getElementById("adminForecastError");
const adminForecastRetryEl = document.getElementById("adminForecastRetry");
const adminForecastQuantityEl = document.getElementById("adminForecastQuantity");
const adminForecastDateEl = document.getElementById("adminForecastDate");
const adminForecast7AverageEl = document.getElementById("adminForecast7Average");
const adminForecast28AverageEl = document.getElementById("adminForecast28Average");
const adminForecast7ComparisonEl = document.getElementById("adminForecast7Comparison");
const adminForecast28ComparisonEl = document.getElementById("adminForecast28Comparison");
const adminForecastDataThroughEl = document.getElementById("adminForecastDataThrough");
const adminForecastDateContextEl = document.getElementById("adminForecastDateContext");

function calendarElements(prefix) {
  return {
    picker: document.getElementById(`${prefix}Picker`),
    trigger: document.getElementById(`${prefix}Trigger`),
    value: document.getElementById(`${prefix}Value`),
    input: document.getElementById(`${prefix}Input`),
    calendar: document.getElementById(`${prefix}Calendar`),
    prev: document.getElementById(`${prefix}Prev`),
    next: document.getElementById(`${prefix}Next`),
    month: document.getElementById(`${prefix}Month`),
    year: document.getElementById(`${prefix}Year`),
    weekdays: document.getElementById(`${prefix}Weekdays`),
    grid: document.getElementById(`${prefix}Grid`),
    viewDate: null,
  };
}
const startCalendar = calendarElements("adminSalesTrendStart");
const endCalendar = calendarElements("adminSalesTrendEnd");

// analyticsGeneration dinaikkan setiap kali identitas admin efektif berubah
// (logout, role turun, atau ganti akun admin) - loader yang masih berjalan
// mengecek generation sebelum merender supaya respons "telat" dari admin/sesi
// sebelumnya tidak pernah tampil setelah identitas berubah.
let analyticsGeneration = 0;
let analyticsAdminUserId = null;
let analyticsState = null;
let analyticsChartTransitionTimer = null;

function createAnalyticsState() {
  return {
    summary: { status: "idle", data: null, cache: new Map(), requestId: 0, rangeKey: null },
    products: { status: "idle", data: null, cache: new Map(), requestId: 0, rangeKey: null },
    categories: { status: "idle", data: null, cache: new Map(), requestId: 0, rangeKey: null },
    trend: { status: "idle", data: null, rangeKey: null, cache: new Map(), requestId: 0 },
    forecast: { status: "idle", data: null, requestId: 0 },
    minAvailableDate: null,
    maxAvailableDate: null,
    appliedStartDate: null,
    appliedEndDate: null,
  };
}

function showAnalyticsSectionStatus(el, key, type) {
  el.dataset.i18n = key;
  el.textContent = translations[document.documentElement.lang][key];
  el.className = `menu-status ${type}`;
  const isError = type === "error";
  el.setAttribute("role", isError ? "alert" : "status");
  // aria-live eksplisit HARUS ikut role: "alert" secara implisit berarti
  // assertive, tapi atribut aria-live eksplisit menang atas role kalau
  // nilainya berbeda - tanpa baris ini status error bisa dianggap "polite"
  // oleh sebagian AT walau role-nya "alert".
  el.setAttribute("aria-live", isError ? "assertive" : "polite");
}

function hideAnalyticsSectionStatus(el) {
  el.className = "menu-status hide";
  el.removeAttribute("data-i18n");
  el.textContent = "";
  el.setAttribute("role", "status");
  el.setAttribute("aria-live", "polite");
}

function resetAnalyticsDom() {
  if (analyticsChartTransitionTimer !== null) clearTimeout(analyticsChartTransitionTimer);
  analyticsChartTransitionTimer = null;
  adminAnalyticsRevenueEl.textContent = "—";
  adminAnalyticsOrdersEl.textContent = "—";
  adminAnalyticsQuantityEl.textContent = "—";
  adminAnalyticsAOVEl.textContent = "—";
  adminAnalyticsProductBodyEl.innerHTML = "";
  adminAnalyticsCategoryChartEl.innerHTML = "";
  hideAnalyticsSectionStatus(adminAnalyticsStatusEl);
  hideAnalyticsSectionStatus(adminAnalyticsProductsStatusEl);
  hideAnalyticsSectionStatus(adminAnalyticsCategoriesStatusEl);
  adminSalesTrendRangeEl.textContent = "—";
  adminSalesTrendRevenueEl.textContent = "—";
  adminSalesTrendOrdersEl.textContent = "—";
  adminSalesTrendQuantityEl.textContent = "—";
  adminSalesTrendAOVEl.textContent = "—";
  adminSalesTrendHighEl.textContent = "—";
  adminSalesTrendLowEl.textContent = "—";
  adminSalesTrendChartEl.innerHTML = "";
  adminSalesTrendTableBodyEl.innerHTML = "";
  adminSalesTrendStartEl.value = "";
  adminSalesTrendEndEl.value = "";
  startCalendar.value.textContent = "—";
  endCalendar.value.textContent = "—";
  startCalendar.trigger.disabled = true;
  endCalendar.trigger.disabled = true;
  adminSalesTrendApplyBtnEl.disabled = true;
  adminAnalyticsAvailablePeriodEl.textContent = "—";
  adminAnalyticsAppliedPeriodEl.textContent = "—";
  hideAnalyticsSectionStatus(adminSalesTrendStatusEl);
  adminForecastContentEl.hidden = true;
  adminForecastErrorEl.hidden = true;
  adminForecastStatusEl.hidden = false;
  showAnalyticsSectionStatus(adminForecastStatusEl, "admin.forecastLoading", "loading");
}

function isForecastResponse(data) {
  if (!data || typeof data !== "object" || !isIsoCalendarDate(data.forecast_date) ||
      typeof data.predicted_quantity !== "number" || !Number.isFinite(data.predicted_quantity) || data.predicted_quantity < 0) return false;
  const context = data.historical_context;
  const model = data.model;
  if (!context || typeof context !== "object" || !isIsoCalendarDate(context.data_through) ||
      ![context.trailing_7_day_average, context.trailing_28_day_average].every((value) => typeof value === "number" && Number.isFinite(value) && value >= 0) ||
      ![context.vs_7_day_average_percent, context.vs_28_day_average_percent].every((value) => value === null || (typeof value === "number" && Number.isFinite(value))) ||
      !model || model.family !== "hist_gradient_boosting" || model.artifact_version !== "1.0" || model.forecast_horizon_days !== 1) return false;
  const next = new Date(`${context.data_through}T00:00:00Z`); next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10) === data.forecast_date;
}

async function fetchForecast() {
  const response = await fetch(`${API_BASE_URL}/api/analytics/forecast/next-day`, { credentials: "include" });
  if (!response.ok) throw new Error(`Forecast API gagal dengan status ${response.status}`);
  const data = await response.json();
  if (!isForecastResponse(data)) throw new Error("Respons forecast tidak valid");
  return data;
}

function forecastTemplate(key, value) {
  return translations[document.documentElement.lang][key].replace("{value}", value).replace("{date}", value);
}

function formatForecastComparison(value) {
  if (value === null) return forecastTemplate("admin.forecastUnavailable", "");
  const rounded = Math.round(value * 10) / 10;
  if (Math.abs(rounded) < 0.05) return forecastTemplate("admin.forecastClose", "");
  const locale = document.documentElement.lang === "en" ? "en-US" : "id-ID";
  const formatted = Math.abs(rounded).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return forecastTemplate(rounded > 0 ? "admin.forecastAbove" : "admin.forecastBelow", formatted);
}

function renderForecast(data) {
  const locale = document.documentElement.lang === "en" ? "en-US" : "id-ID";
  const unit = Math.round(data.predicted_quantity).toLocaleString(locale);
  const average = (value) => value.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  adminForecastQuantityEl.textContent = forecastTemplate("admin.forecastQuantity", unit);
  adminForecastDateEl.textContent = formatAnalyticsDate(data.forecast_date);
  adminForecastDateEl.setAttribute("datetime", data.forecast_date);
  adminForecast7AverageEl.textContent = forecastTemplate("admin.forecastAverage", average(data.historical_context.trailing_7_day_average));
  adminForecast28AverageEl.textContent = forecastTemplate("admin.forecastAverage", average(data.historical_context.trailing_28_day_average));
  adminForecast7ComparisonEl.textContent = formatForecastComparison(data.historical_context.vs_7_day_average_percent);
  adminForecast28ComparisonEl.textContent = formatForecastComparison(data.historical_context.vs_28_day_average_percent);
  adminForecastDataThroughEl.textContent = forecastTemplate("admin.forecastThroughPrefix", formatAnalyticsDate(data.historical_context.data_through));
  adminForecastDateContextEl.textContent = formatAnalyticsDate(data.forecast_date);
  adminForecastStatusEl.hidden = true; adminForecastErrorEl.hidden = true; adminForecastContentEl.hidden = false;
}

async function loadForecast(generation) {
  if (!analyticsState) return;
  const section = analyticsState.forecast;
  if (section.status === "success" && section.data) { renderForecast(section.data); return; }
  const requestId = ++section.requestId;
  section.status = "loading"; section.data = null;
  adminForecastContentEl.hidden = true; adminForecastErrorEl.hidden = true; adminForecastStatusEl.hidden = false;
  showAnalyticsSectionStatus(adminForecastStatusEl, "admin.forecastLoading", "loading");
  try {
    const data = await fetchForecast();
    if (generation !== analyticsGeneration || !analyticsState || requestId !== analyticsState.forecast.requestId) return;
    section.status = "success"; section.data = data; renderForecast(data);
  } catch (error) {
    if (generation !== analyticsGeneration || !analyticsState || requestId !== analyticsState.forecast.requestId) return;
    section.status = "error"; section.data = null; adminForecastStatusEl.hidden = true; adminForecastContentEl.hidden = true; adminForecastErrorEl.hidden = false;
    console.error("Gagal memuat forecast:", error);
  }
}

adminForecastRetryEl.addEventListener("click", () => loadForecast(analyticsGeneration));

function analyticsRangeQuery(startDate, endDate) {
  const query = new URLSearchParams();
  if (startDate) query.set("start_date", startDate);
  if (endDate) query.set("end_date", endDate);
  return query.toString() ? `?${query.toString()}` : "";
}

async function fetchAnalyticsSummary(startDate, endDate) {
  const response = await fetch(`${API_BASE_URL}/api/analytics/summary${analyticsRangeQuery(startDate, endDate)}`, { credentials: "include" });
  if (!response.ok) throw new Error(`Analytics summary API gagal dengan status ${response.status}`);
  const data = await response.json();
  if (
    !data ||
    typeof data !== "object" ||
    typeof data.total_revenue !== "number" ||
    !Number.isFinite(data.total_revenue) ||
    data.total_revenue < 0 ||
    !Number.isInteger(data.unique_orders) ||
    data.unique_orders < 0 ||
    !Number.isInteger(data.total_quantity) ||
    data.total_quantity < 0 ||
    typeof data.average_order_value !== "number" ||
    !Number.isFinite(data.average_order_value) ||
    data.average_order_value < 0
  ) {
    throw new Error("Respons analytics summary tidak valid");
  }
  return data;
}

async function fetchAnalyticsProducts(startDate, endDate) {
  const response = await fetch(`${API_BASE_URL}/api/analytics/products${analyticsRangeQuery(startDate, endDate)}`, { credentials: "include" });
  if (!response.ok) throw new Error(`Analytics products API gagal dengan status ${response.status}`);
  const data = await response.json();
  const products = data && typeof data === "object" ? data.products : null;
  const isValid =
    Array.isArray(products) &&
    products.every(
      (product) =>
        product &&
        typeof product === "object" &&
        typeof product.product_name === "string" &&
        product.product_name.trim().length > 0 &&
        Number.isInteger(product.total_quantity) &&
        product.total_quantity >= 0 &&
        typeof product.total_revenue === "number" &&
        Number.isFinite(product.total_revenue) &&
        product.total_revenue >= 0
    );
  if (!isValid) throw new Error("Respons analytics products tidak valid");
  return products;
}

async function fetchAnalyticsCategories(startDate, endDate) {
  const response = await fetch(`${API_BASE_URL}/api/analytics/categories${analyticsRangeQuery(startDate, endDate)}`, { credentials: "include" });
  if (!response.ok) throw new Error(`Analytics categories API gagal dengan status ${response.status}`);
  const data = await response.json();
  const categories = data && typeof data === "object" ? data.categories : null;
  const isValid =
    Array.isArray(categories) &&
    categories.every(
      (category) =>
        category &&
        typeof category === "object" &&
        typeof category.category === "string" &&
        category.category.trim().length > 0 &&
        typeof category.total_revenue === "number" &&
        Number.isFinite(category.total_revenue) &&
        category.total_revenue >= 0
    );
  if (!isValid) throw new Error("Respons analytics categories tidak valid");
  return categories;
}

function isIsoCalendarDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validateSalesTrend(data) {
  if (!data || typeof data !== "object" || !isIsoCalendarDate(data.start_date) ||
      !isIsoCalendarDate(data.end_date) || data.start_date > data.end_date || !data.summary ||
      !data.available_period || !isIsoCalendarDate(data.available_period.min_available_date) ||
      !isIsoCalendarDate(data.available_period.max_available_date) ||
      data.available_period.min_available_date > data.start_date ||
      data.end_date > data.available_period.max_available_date ||
      !Array.isArray(data.daily_sales) || data.daily_sales.length > 3660) return false;
  const summary = data.summary;
  if (typeof summary.total_revenue !== "number" || !Number.isFinite(summary.total_revenue) || summary.total_revenue < 0 ||
      !Number.isInteger(summary.unique_orders) || summary.unique_orders < 0 ||
      !Number.isInteger(summary.total_quantity) || summary.total_quantity < 0 ||
      typeof summary.average_order_value !== "number" || !Number.isFinite(summary.average_order_value) || summary.average_order_value < 0) return false;
  const expectedAov = summary.unique_orders === 0 ? 0 : summary.total_revenue / summary.unique_orders;
  if (Math.abs(summary.average_order_value - expectedAov) > 1e-9) return false;
  let previous = "";
  let revenue = 0;
  let quantity = 0;
  for (const point of data.daily_sales) {
    if (!point || typeof point !== "object" || !isIsoCalendarDate(point.date) || point.date <= previous ||
        point.date < data.start_date || point.date > data.end_date ||
        typeof point.total_revenue !== "number" || !Number.isFinite(point.total_revenue) || point.total_revenue < 0 ||
        !Number.isInteger(point.unique_orders) || point.unique_orders < 0 ||
        !Number.isInteger(point.total_quantity) || point.total_quantity < 0) return false;
    previous = point.date;
    revenue += point.total_revenue;
    quantity += point.total_quantity;
  }
  if (revenue !== summary.total_revenue || quantity !== summary.total_quantity) return false;
  if (data.daily_sales.length === 0) return data.high_day === null && data.low_day === null && summary.total_revenue === 0 && summary.unique_orders === 0 && summary.total_quantity === 0 && summary.average_order_value === 0;
  const validDay = (day) => day && isIsoCalendarDate(day.date) && typeof day.total_revenue === "number" && Number.isFinite(day.total_revenue);
  if (!validDay(data.high_day) || !validDay(data.low_day)) return false;
  const high = data.daily_sales.reduce((best, point) => point.total_revenue > best.total_revenue ? point : best);
  const low = data.daily_sales.reduce((best, point) => point.total_revenue < best.total_revenue ? point : best);
  return data.high_day.date === high.date && data.high_day.total_revenue === high.total_revenue &&
    data.low_day.date === low.date && data.low_day.total_revenue === low.total_revenue;
}

async function fetchSalesTrend(startDate, endDate) {
  const query = new URLSearchParams();
  if (startDate) query.set("start_date", startDate);
  if (endDate) query.set("end_date", endDate);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  const response = await fetch(`${API_BASE_URL}/api/analytics/sales-trend${suffix}`, { credentials: "include" });
  if (!response.ok) throw new Error(`Sales trend API gagal dengan status ${response.status}`);
  const data = await response.json();
  if (!validateSalesTrend(data)) throw new Error("Respons sales trend tidak valid");
  return data;
}

function formatAnalyticsDate(value) {
  const locale = document.documentElement.lang === "en" ? "en-GB" : "id-ID";
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${value}T00:00:00Z`));
}

function isoFromDate(dateValue) {
  return dateValue.toISOString().slice(0, 10);
}

function monthStart(isoDate) {
  const dateValue = new Date(`${isoDate}T00:00:00Z`);
  return new Date(Date.UTC(dateValue.getUTCFullYear(), dateValue.getUTCMonth(), 1));
}

function renderAvailablePeriod() {
  if (!analyticsState || !analyticsState.minAvailableDate) return;
  const lang = document.documentElement.lang;
  adminAnalyticsAvailablePeriodEl.textContent = `${translations[lang]["admin.availablePeriod"]}: ${formatAnalyticsDate(analyticsState.minAvailableDate)} – ${formatAnalyticsDate(analyticsState.maxAvailableDate)}`;
  adminAnalyticsAppliedPeriodEl.textContent = `${formatAnalyticsDate(analyticsState.appliedStartDate)} – ${formatAnalyticsDate(analyticsState.appliedEndDate)}`;
  startCalendar.value.textContent = formatAnalyticsDate(adminSalesTrendStartEl.value);
  endCalendar.value.textContent = formatAnalyticsDate(adminSalesTrendEndEl.value);
}

function closeCalendar(calendar, returnFocus = false) {
  calendar.calendar.hidden = true;
  calendar.trigger.setAttribute("aria-expanded", "false");
  if (returnFocus) calendar.trigger.focus();
}

function visibleBottomObstructionTop(viewportBottom, margin) {
  const cartBar = document.getElementById("cartBar");
  if (!cartBar || cartBar.hidden) return viewportBottom - margin;
  const rect = cartBar.getBoundingClientRect();
  const overlapsViewportBottom = rect.height > 0 && rect.top < viewportBottom && rect.bottom >= viewportBottom - margin;
  return overlapsViewportBottom ? rect.top - margin : viewportBottom - margin;
}

function visibleTopObstructionBottom(viewportTop, margin, gap) {
  const defaultTop = viewportTop + margin;
  const navbar = document.getElementById("navbar");
  if (!navbar || navbar.hidden || !navbar.classList.contains("navbar")) return defaultTop;
  const rect = navbar.getBoundingClientRect();
  const overlapsViewportTop = rect.height > 0 && rect.top <= defaultTop && rect.bottom > viewportTop;
  return overlapsViewportTop ? Math.max(defaultTop, rect.bottom + gap) : defaultTop;
}

function positionCalendar(calendar) {
  if (calendar.calendar.hidden) return;
  const margin = 12;
  const gap = 8;
  const visualViewport = window.visualViewport;
  const viewportLeft = visualViewport ? visualViewport.offsetLeft : 0;
  const viewportTop = visualViewport ? visualViewport.offsetTop : 0;
  const viewportWidth = visualViewport?.width || window.innerWidth || document.documentElement.clientWidth;
  const viewportHeight = visualViewport?.height || window.innerHeight || document.documentElement.clientHeight;
  const viewportBottom = viewportTop + viewportHeight;
  const usableTop = visibleTopObstructionBottom(viewportTop, margin, gap);
  const triggerRect = calendar.trigger.getBoundingClientRect();
  const calendarRect = calendar.calendar.getBoundingClientRect();
  const desiredHeight = calendar.calendar.scrollHeight || calendarRect.height;
  const usableBottom = Math.max(usableTop, visibleBottomObstructionTop(viewportBottom, margin));
  const availableBelow = Math.max(0, usableBottom - triggerRect.bottom - gap);
  const availableAbove = Math.max(0, triggerRect.top - gap - usableTop);
  const fitsBelow = desiredHeight <= availableBelow;
  const fitsAbove = desiredHeight <= availableAbove;
  const openAbove = !fitsBelow && (fitsAbove || availableAbove > availableBelow);
  const availableHeight = Math.max(0, Math.min(usableBottom - usableTop, openAbove ? availableAbove : availableBelow));
  const renderedHeight = Math.min(desiredHeight, availableHeight);
  const minLeft = viewportLeft + margin;
  const maxLeft = Math.max(minLeft, viewportLeft + viewportWidth - calendarRect.width - margin);
  const naturalTop = openAbove ? triggerRect.top - gap - renderedHeight : triggerRect.bottom + gap;
  const maxTop = Math.max(usableTop, usableBottom - renderedHeight);
  const clampedTop = Math.max(usableTop, Math.min(maxTop, naturalTop));

  calendar.calendar.classList.toggle("opens-above", openAbove);
  calendar.calendar.style.left = `${Math.max(minLeft, Math.min(maxLeft, triggerRect.right - calendarRect.width))}px`;
  calendar.calendar.style.right = "auto";
  calendar.calendar.style.top = `${clampedTop}px`;
  calendar.calendar.style.bottom = "auto";
  calendar.calendar.style.maxHeight = `${availableHeight}px`;
}

function renderCalendar(calendar) {
  if (!analyticsState || !analyticsState.minAvailableDate) return;
  const minDate = analyticsState.minAvailableDate;
  const maxDate = analyticsState.maxAvailableDate;
  const selectedDate = calendar.input.value;
  const view = calendar.viewDate || monthStart(selectedDate || minDate);
  calendar.viewDate = view;
  const year = view.getUTCFullYear();
  const month = view.getUTCMonth();
  const min = new Date(`${minDate}T00:00:00Z`); const max = new Date(`${maxDate}T00:00:00Z`);
  const lang = document.documentElement.lang === "en" ? "en-US" : "id-ID";

  calendar.year.innerHTML = "";
  for (let value = min.getUTCFullYear(); value <= max.getUTCFullYear(); value += 1) {
    const option = document.createElement("option"); option.value = String(value); option.textContent = String(value); option.selected = value === year; calendar.year.appendChild(option);
  }
  calendar.year.value = String(year);
  calendar.month.innerHTML = "";
  for (let value = 0; value < 12; value += 1) {
    const option = document.createElement("option"); option.value = String(value);
    option.textContent = new Intl.DateTimeFormat(lang, { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2020, value, 1)));
    option.disabled = (year === min.getUTCFullYear() && value < min.getUTCMonth()) || (year === max.getUTCFullYear() && value > max.getUTCMonth());
    option.selected = value === month; calendar.month.appendChild(option);
  }
  calendar.month.value = String(month);
  const currentMonthIndex = year * 12 + month;
  calendar.prev.disabled = currentMonthIndex <= min.getUTCFullYear() * 12 + min.getUTCMonth();
  calendar.next.disabled = currentMonthIndex >= max.getUTCFullYear() * 12 + max.getUTCMonth();
  calendar.weekdays.innerHTML = "";
  for (let day = 0; day < 7; day += 1) {
    const label = document.createElement("span"); label.textContent = new Intl.DateTimeFormat(lang, { weekday: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2026, 7, 2 + day))); calendar.weekdays.appendChild(label);
  }
  calendar.grid.innerHTML = "";
  const firstWeekday = new Date(Date.UTC(year, month, 1)).getUTCDay();
  for (let index = 0; index < firstWeekday; index += 1) calendar.grid.appendChild(document.createElement("span"));
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const today = isoFromDate(new Date());
  for (let day = 1; day <= daysInMonth; day += 1) {
    const isoDate = isoFromDate(new Date(Date.UTC(year, month, day)));
    const button = document.createElement("button"); button.type = "button"; button.textContent = String(day); button.dataset.date = isoDate;
    button.setAttribute("role", "gridcell"); button.setAttribute("aria-label", formatAnalyticsDate(isoDate));
    button.disabled = isoDate < minDate || isoDate > maxDate;
    button.setAttribute("aria-selected", isoDate === selectedDate ? "true" : "false");
    if (isoDate === selectedDate) button.classList.add("is-selected");
    if (isoDate === today) button.setAttribute("aria-current", "date");
    button.addEventListener("click", () => {
      calendar.input.value = isoDate; calendar.value.textContent = formatAnalyticsDate(isoDate); closeCalendar(calendar, true);
    });
    button.addEventListener("keydown", (event) => {
      const offsets = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
      if (!(event.key in offsets)) return;
      event.preventDefault();
      const next = new Date(`${isoDate}T00:00:00Z`); next.setUTCDate(next.getUTCDate() + offsets[event.key]);
      const nextIso = isoFromDate(next);
      if (nextIso < minDate || nextIso > maxDate) return;
      calendar.viewDate = monthStart(nextIso); renderCalendar(calendar);
      queueMicrotask(() => calendar.grid.querySelector(`[data-date="${nextIso}"]`)?.focus());
    });
    calendar.grid.appendChild(button);
  }
  positionCalendar(calendar);
}

function openCalendar(calendar) {
  const other = calendar === startCalendar ? endCalendar : startCalendar;
  closeCalendar(other);
  calendar.viewDate = monthStart(calendar.input.value || analyticsState.minAvailableDate);
  renderCalendar(calendar); calendar.calendar.hidden = false; calendar.trigger.setAttribute("aria-expanded", "true");
  positionCalendar(calendar);
  queueMicrotask(() => (calendar.grid.querySelector(`[data-date="${calendar.input.value}"]`) || calendar.grid.querySelector("button:not([disabled])"))?.focus());
}

function changeCalendarMonth(calendar, delta) {
  const next = new Date(calendar.viewDate); next.setUTCMonth(next.getUTCMonth() + delta); calendar.viewDate = next; renderCalendar(calendar);
}

function setupCalendar(calendar) {
  calendar.calendar.hidden = true;
  calendar.trigger.addEventListener("click", () => calendar.calendar.hidden ? openCalendar(calendar) : closeCalendar(calendar, true));
  calendar.prev.addEventListener("click", () => changeCalendarMonth(calendar, -1));
  calendar.next.addEventListener("click", () => changeCalendarMonth(calendar, 1));
  calendar.month.addEventListener("change", () => { calendar.viewDate = new Date(Date.UTC(Number(calendar.year.value), Number(calendar.month.value), 1)); renderCalendar(calendar); });
  calendar.year.addEventListener("change", () => {
    const year = Number(calendar.year.value); const min = new Date(`${analyticsState.minAvailableDate}T00:00:00Z`); const max = new Date(`${analyticsState.maxAvailableDate}T00:00:00Z`);
    const month = Math.max(year === min.getUTCFullYear() ? min.getUTCMonth() : 0, Math.min(year === max.getUTCFullYear() ? max.getUTCMonth() : 11, calendar.viewDate.getUTCMonth()));
    calendar.viewDate = new Date(Date.UTC(year, month, 1)); renderCalendar(calendar);
  });
  calendar.calendar.addEventListener("keydown", (event) => { if (event.key === "Escape") { event.preventDefault(); closeCalendar(calendar, true); } });
}

setupCalendar(startCalendar);
setupCalendar(endCalendar);
document.addEventListener("pointerdown", (event) => {
  for (const calendar of [startCalendar, endCalendar]) if (!calendar.calendar.hidden && !calendar.picker.contains(event.target)) closeCalendar(calendar);
});
window.addEventListener("resize", () => {
  for (const calendar of [startCalendar, endCalendar]) positionCalendar(calendar);
});
window.visualViewport?.addEventListener("resize", () => {
  for (const calendar of [startCalendar, endCalendar]) positionCalendar(calendar);
});

function showSalesPoint(point, x, y, svg) {
  const lang = document.documentElement.lang;
  adminSalesTrendTooltipEl.textContent = `${formatAnalyticsDate(point.date)} · ${translations[lang]["admin.analyticsColRevenue"]}: ${formatRupiah(point.total_revenue)} · ${translations[lang]["admin.analyticsOrders"]}: ${point.unique_orders} · ${translations[lang]["admin.analyticsQuantity"]}: ${point.total_quantity}`;
  adminSalesTrendTooltipEl.classList.remove("hide");
  const svgRect = svg.getBoundingClientRect();
  const wrapperRect = adminSalesTrendChartEl.parentNode.getBoundingClientRect();
  const scaleX = svgRect.width / 800 || 1;
  const scaleY = svgRect.height / 300 || scaleX;
  const tooltipWidth = adminSalesTrendTooltipEl.offsetWidth || 190;
  const tooltipHeight = adminSalesTrendTooltipEl.offsetHeight || 64;
  const pointLeft = (svgRect.left - wrapperRect.left) + x * scaleX;
  const pointTop = (svgRect.top - wrapperRect.top) + y * scaleY;
  const maxLeft = Math.max(8, wrapperRect.width - tooltipWidth - 8);
  const maxTop = Math.max(8, wrapperRect.height - tooltipHeight - 8);
  const preferredLeft = pointLeft + 12;
  const preferredTop = pointTop - tooltipHeight - 12;
  adminSalesTrendTooltipEl.style.left = `${Math.max(8, Math.min(maxLeft, preferredLeft))}px`;
  adminSalesTrendTooltipEl.style.top = `${Math.max(8, Math.min(maxTop, preferredTop < 8 ? pointTop + 12 : preferredTop))}px`;
}

function renderSalesTrend(data) {
  const summary = data.summary;
  adminSalesTrendRangeEl.textContent = `${formatAnalyticsDate(data.start_date)} – ${formatAnalyticsDate(data.end_date)}`;
  adminSalesTrendRevenueEl.textContent = formatRupiah(summary.total_revenue);
  adminSalesTrendOrdersEl.textContent = summary.unique_orders.toLocaleString("id-ID");
  adminSalesTrendQuantityEl.textContent = summary.total_quantity.toLocaleString("id-ID");
  adminSalesTrendAOVEl.textContent = formatRupiah(summary.average_order_value);
  adminSalesTrendHighEl.textContent = data.high_day ? `${formatRupiah(data.high_day.total_revenue)} — ${formatAnalyticsDate(data.high_day.date)}` : "—";
  adminSalesTrendLowEl.textContent = data.low_day ? `${formatRupiah(data.low_day.total_revenue)} — ${formatAnalyticsDate(data.low_day.date)}` : "—";
  adminSalesTrendChartEl.innerHTML = "";
  adminSalesTrendTableBodyEl.innerHTML = "";
  adminSalesTrendTooltipEl.classList.add("hide");
  adminSalesTrendTooltipEl.textContent = "";
  adminSalesTrendTooltipEl.style.left = "";
  adminSalesTrendTooltipEl.style.top = "";
  data.daily_sales.forEach((point) => {
    const row = document.createElement("tr");
    [formatAnalyticsDate(point.date), formatRupiah(point.total_revenue), String(point.unique_orders), String(point.total_quantity)].forEach((value) => {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.appendChild(cell);
    });
    adminSalesTrendTableBodyEl.appendChild(row);
  });
  if (data.daily_sales.length === 0) {
    showAnalyticsSectionStatus(adminSalesTrendStatusEl, "admin.salesTrendEmpty", "empty");
    return;
  }
  hideAnalyticsSectionStatus(adminSalesTrendStatusEl);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 800 300");
  svg.setAttribute("aria-label", translations[document.documentElement.lang]["admin.salesTrendTitle"]);
  const left = 68, right = 780, top = 24, bottom = 250;
  const maxRevenue = Math.max(...data.daily_sales.map((point) => point.total_revenue), 1);
  for (let index = 0; index <= 4; index += 1) {
    const y = top + ((bottom - top) * index / 4);
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", left); line.setAttribute("x2", right); line.setAttribute("y1", y); line.setAttribute("y2", y); line.setAttribute("class", "admin-sales-chart-grid");
    svg.appendChild(line);
    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    const tickRevenue = Math.round(maxRevenue * (1 - index / 4));
    label.setAttribute("x", left - 8); label.setAttribute("y", y + 4); label.setAttribute("text-anchor", "end"); label.setAttribute("class", "admin-sales-chart-label");
    label.textContent = tickRevenue >= 1000 ? `Rp${Math.round(tickRevenue / 1000)}rb` : `Rp${tickRevenue}`;
    svg.appendChild(label);
  }
  const coords = data.daily_sales.map((point, index) => ({
    point,
    x: data.daily_sales.length === 1 ? (left + right) / 2 : left + ((right - left) * index / (data.daily_sales.length - 1)),
    y: bottom - ((bottom - top) * point.total_revenue / maxRevenue),
  }));
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", coords.length === 1
    ? `M ${coords[0].x - 18} ${coords[0].y} L ${coords[0].x + 18} ${coords[0].y}`
    : coords.map(({ x, y }, index) => `${index ? "L" : "M"} ${x} ${y}`).join(" "));
  path.setAttribute("class", "admin-sales-chart-line");
  svg.appendChild(path);
  const activeMarker = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  activeMarker.setAttribute("r", 5); activeMarker.setAttribute("class", "admin-sales-chart-active-marker is-hidden"); activeMarker.setAttribute("hidden", "");
  svg.appendChild(activeMarker);
  let activeIndex = -1;
  const selectPoint = (index) => {
    activeIndex = Math.max(0, Math.min(coords.length - 1, index));
    const selected = coords[activeIndex];
    activeMarker.setAttribute("cx", selected.x); activeMarker.setAttribute("cy", selected.y);
    activeMarker.classList.remove("is-hidden"); activeMarker.removeAttribute("hidden");
    showSalesPoint(selected.point, selected.x, selected.y, svg);
  };
  const overlay = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  overlay.setAttribute("x", left); overlay.setAttribute("y", top); overlay.setAttribute("width", right - left); overlay.setAttribute("height", bottom - top);
  overlay.setAttribute("class", "admin-sales-chart-hit-area"); overlay.setAttribute("tabindex", "0");
  overlay.setAttribute("aria-label", translations[document.documentElement.lang]["admin.chartExplore"]);
  const selectNearest = (event) => {
    const rect = svg.getBoundingClientRect();
    const viewX = ((event.clientX - rect.left) / (rect.width || 1)) * 800;
    const ratio = Math.max(0, Math.min(1, (viewX - left) / (right - left)));
    selectPoint(coords.length === 1 ? 0 : Math.round(ratio * (coords.length - 1)));
  };
  overlay.addEventListener("pointermove", selectNearest);
  overlay.addEventListener("click", selectNearest);
  overlay.addEventListener("focus", () => selectPoint(activeIndex < 0 ? 0 : activeIndex));
  overlay.addEventListener("keydown", (event) => {
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault(); selectPoint((activeIndex < 0 ? 0 : activeIndex) + (event.key === "ArrowRight" ? 1 : -1));
    } else if (event.key === "Escape") {
      adminSalesTrendTooltipEl.classList.add("hide"); activeMarker.classList.add("is-hidden"); activeMarker.setAttribute("hidden", ""); activeIndex = -1;
    }
  });
  overlay.addEventListener("pointerleave", () => { adminSalesTrendTooltipEl.classList.add("hide"); activeMarker.classList.add("is-hidden"); activeMarker.setAttribute("hidden", ""); activeIndex = -1; });
  overlay.addEventListener("blur", () => { adminSalesTrendTooltipEl.classList.add("hide"); activeMarker.classList.add("is-hidden"); activeMarker.setAttribute("hidden", ""); activeIndex = -1; });
  svg.appendChild(overlay);
  const labelStep = Math.max(1, Math.ceil(coords.length / 5));
  coords.forEach(({ point, x }, index) => {
    if (index % labelStep !== 0 && index !== coords.length - 1) return;
    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    label.setAttribute("x", x); label.setAttribute("y", 278); label.setAttribute("text-anchor", "middle"); label.setAttribute("class", "admin-sales-chart-label");
    label.textContent = point.date.slice(5).split("-").reverse().join("/");
    svg.appendChild(label);
  });
  adminSalesTrendChartEl.appendChild(svg);
  if (analyticsChartTransitionTimer !== null) clearTimeout(analyticsChartTransitionTimer);
  adminSalesTrendChartEl.classList.add("is-entering");
  analyticsChartTransitionTimer = setTimeout(() => {
    adminSalesTrendChartEl.classList.remove("is-entering"); analyticsChartTransitionTimer = null;
  }, 260);
}

function clearSalesTrendVisualization() {
  adminSalesTrendRangeEl.textContent = "—";
  adminSalesTrendRevenueEl.textContent = "—";
  adminSalesTrendOrdersEl.textContent = "—";
  adminSalesTrendQuantityEl.textContent = "—";
  adminSalesTrendAOVEl.textContent = "—";
  adminSalesTrendHighEl.textContent = "—";
  adminSalesTrendLowEl.textContent = "—";
  adminSalesTrendChartEl.innerHTML = "";
  adminSalesTrendTableBodyEl.innerHTML = "";
  adminSalesTrendTooltipEl.classList.add("hide");
  adminSalesTrendTooltipEl.textContent = "";
  adminSalesTrendTooltipEl.style.left = "";
  adminSalesTrendTooltipEl.style.top = "";
}

function applyAnalyticsAvailability(data) {
  analyticsState.minAvailableDate = data.available_period.min_available_date;
  analyticsState.maxAvailableDate = data.available_period.max_available_date;
  if (!analyticsState.appliedStartDate) {
    analyticsState.appliedStartDate = data.start_date;
    analyticsState.appliedEndDate = data.end_date;
    adminSalesTrendStartEl.value = data.start_date;
    adminSalesTrendEndEl.value = data.end_date;
  }
  startCalendar.trigger.disabled = false; endCalendar.trigger.disabled = false; adminSalesTrendApplyBtnEl.disabled = false;
  renderAvailablePeriod();
}

async function loadSalesTrend(generation, startDate, endDate) {
  const trend = analyticsState.trend;
  const rangeKey = `${startDate || "all"}|${endDate || "all"}`;
  const cached = trend.cache.get(rangeKey);
  if (cached) { trend.requestId += 1; trend.data = cached; trend.rangeKey = rangeKey; trend.status = cached.daily_sales.length ? "success" : "empty"; applyAnalyticsAvailability(cached); renderSalesTrend(cached); return; }
  const requestId = ++trend.requestId;
  trend.status = "loading";
  trend.data = null;
  clearSalesTrendVisualization();
  showAnalyticsSectionStatus(adminSalesTrendStatusEl, "admin.salesTrendLoading", "loading");
  try {
    const data = await fetchSalesTrend(startDate, endDate);
    if (generation !== analyticsGeneration || !analyticsState || requestId !== analyticsState.trend.requestId) return;
    trend.cache.set(rangeKey, data);
    trend.cache.set(`${data.start_date}|${data.end_date}`, data);
    trend.data = data; trend.rangeKey = `${data.start_date}|${data.end_date}`;
    trend.status = data.daily_sales.length ? "success" : "empty";
    applyAnalyticsAvailability(data);
    renderSalesTrend(data);
  } catch (error) {
    if (generation !== analyticsGeneration || !analyticsState || requestId !== analyticsState.trend.requestId) return;
    trend.status = "error";
    console.error("Gagal memuat tren penjualan:", error);
    showAnalyticsSectionStatus(adminSalesTrendStatusEl, "admin.salesTrendError", "error");
  }
}

function analyticsKey(startDate, endDate) {
  return `${startDate || "all"}|${endDate || "all"}`;
}

function renderAnalyticsSummary(data) {
  adminAnalyticsRevenueEl.textContent = formatRupiah(data.total_revenue);
  adminAnalyticsOrdersEl.textContent = data.unique_orders.toLocaleString("id-ID");
  adminAnalyticsQuantityEl.textContent = data.total_quantity.toLocaleString("id-ID");
  adminAnalyticsAOVEl.textContent = formatRupiah(data.average_order_value);
  hideAnalyticsSectionStatus(adminAnalyticsStatusEl);
}

async function loadAnalyticsSummary(generation, startDate, endDate) {
  const section = analyticsState.summary;
  const rangeKey = analyticsKey(startDate, endDate);
  if (section.cache.has(rangeKey)) {
    section.requestId += 1;
    section.data = section.cache.get(rangeKey); section.rangeKey = rangeKey; section.status = "success";
    renderAnalyticsSummary(section.data); return;
  }
  const requestId = ++section.requestId;
  section.status = "loading"; section.data = null; section.rangeKey = rangeKey;
  adminAnalyticsRevenueEl.textContent = "—"; adminAnalyticsOrdersEl.textContent = "—";
  adminAnalyticsQuantityEl.textContent = "—"; adminAnalyticsAOVEl.textContent = "—";
  showAnalyticsSectionStatus(adminAnalyticsStatusEl, "admin.analyticsLoading", "loading");
  try {
    const data = await fetchAnalyticsSummary(startDate, endDate);
    if (generation !== analyticsGeneration || !analyticsState || requestId !== analyticsState.summary.requestId) return;
    section.cache.set(rangeKey, data); section.data = data; section.status = "success";
    renderAnalyticsSummary(data);
  } catch (error) {
    if (generation !== analyticsGeneration || !analyticsState || requestId !== analyticsState.summary.requestId) return;
    section.status = "error"; section.data = null;
    console.error("Gagal memuat ringkasan analitik:", error);
    showAnalyticsSectionStatus(adminAnalyticsStatusEl, "admin.analyticsError", "error");
  }
}

function renderAnalyticsProducts(products) {
  adminAnalyticsProductBodyEl.innerHTML = "";
  products.forEach((product) => {
    const row = document.createElement("tr");
    const nameCell = document.createElement("td"); nameCell.textContent = product.product_name;
    const qtyCell = document.createElement("td"); qtyCell.textContent = product.total_quantity.toLocaleString("id-ID");
    const revenueCell = document.createElement("td"); revenueCell.textContent = formatRupiah(product.total_revenue);
    row.append(nameCell, qtyCell, revenueCell); adminAnalyticsProductBodyEl.appendChild(row);
  });
  if (products.length === 0) showAnalyticsSectionStatus(adminAnalyticsProductsStatusEl, "admin.analyticsProductsEmpty", "empty");
  else hideAnalyticsSectionStatus(adminAnalyticsProductsStatusEl);
}

async function loadAnalyticsProducts(generation, startDate, endDate) {
  const section = analyticsState.products;
  const rangeKey = analyticsKey(startDate, endDate);
  if (section.cache.has(rangeKey)) {
    section.requestId += 1;
    const products = section.cache.get(rangeKey); section.data = products; section.rangeKey = rangeKey; section.status = products.length ? "success" : "empty";
    renderAnalyticsProducts(products); return;
  }
  const requestId = ++section.requestId;
  section.status = "loading"; section.data = null; section.rangeKey = rangeKey;
  adminAnalyticsProductBodyEl.innerHTML = "";
  showAnalyticsSectionStatus(adminAnalyticsProductsStatusEl, "admin.analyticsLoading", "loading");
  try {
    const products = await fetchAnalyticsProducts(startDate, endDate);
    if (generation !== analyticsGeneration || !analyticsState || requestId !== analyticsState.products.requestId) return;
    section.cache.set(rangeKey, products); section.data = products; section.status = products.length ? "success" : "empty";
    renderAnalyticsProducts(products);
  } catch (error) {
    if (generation !== analyticsGeneration || !analyticsState || requestId !== analyticsState.products.requestId) return;
    section.status = "error"; section.data = null;
    console.error("Gagal memuat performa produk analitik:", error);
    showAnalyticsSectionStatus(adminAnalyticsProductsStatusEl, "admin.analyticsError", "error");
  }
}

// Menghitung lebar bar proporsional (0-100) berdasarkan revenue kategori
// dibanding revenue kategori terbesar di dataset saat ini. Dijaga dari
// pembagian oleh nol saat semua kategori bernilai 0 - hasilnya selalu integer
// 0-100, tidak pernah NaN/Infinity/negatif/di atas 100. Persentase ini murni
// skala visual bar, BUKAN metrik bisnis baru - nilai revenue asli tetap
// ditampilkan sebagai teks di setiap item.
function computeCategoryBarWidth(revenue, maxRevenue) {
  if (!Number.isFinite(revenue) || !Number.isFinite(maxRevenue) || revenue <= 0 || maxRevenue <= 0) {
    return 0;
  }
  const percent = Math.round((revenue / maxRevenue) * 100);
  return Math.min(100, Math.max(0, percent));
}

function renderAnalyticsCategories(categories) {
    adminAnalyticsCategoryChartEl.innerHTML = "";
    if (categories.length > 0) {
      const maxRevenue = Math.max(...categories.map((category) => category.total_revenue));
      const list = document.createElement("ul");
      list.className = "admin-analytics-category-list";
      categories.forEach((category) => {
        const percent = computeCategoryBarWidth(category.total_revenue, maxRevenue);

        const item = document.createElement("li");
        item.className = "admin-analytics-category-item";

        const meta = document.createElement("div");
        meta.className = "admin-analytics-category-meta";
        const nameEl = document.createElement("span");
        nameEl.textContent = category.category;
        const valueEl = document.createElement("span");
        valueEl.textContent = formatRupiah(category.total_revenue);
        meta.append(nameEl, valueEl);

        const track = document.createElement("div");
        track.className = "admin-analytics-category-track";
        track.setAttribute("aria-hidden", "true");
        const fill = document.createElement("div");
        fill.className = "admin-analytics-category-fill";
        fill.style.width = `${percent}%`;
        fill.dataset.barPercent = String(percent);
        track.appendChild(fill);

        item.append(meta, track);
        list.appendChild(item);
      });
      adminAnalyticsCategoryChartEl.appendChild(list);
    }
    if (categories.length === 0) {
      showAnalyticsSectionStatus(adminAnalyticsCategoriesStatusEl, "admin.analyticsCategoriesEmpty", "empty");
    } else {
      hideAnalyticsSectionStatus(adminAnalyticsCategoriesStatusEl);
    }
}

async function loadAnalyticsCategories(generation, startDate, endDate) {
  const section = analyticsState.categories;
  const rangeKey = analyticsKey(startDate, endDate);
  if (section.cache.has(rangeKey)) {
    section.requestId += 1;
    const categories = section.cache.get(rangeKey); section.data = categories; section.rangeKey = rangeKey; section.status = categories.length ? "success" : "empty";
    renderAnalyticsCategories(categories); return;
  }
  const requestId = ++section.requestId;
  section.status = "loading"; section.data = null; section.rangeKey = rangeKey;
  adminAnalyticsCategoryChartEl.innerHTML = "";
  showAnalyticsSectionStatus(adminAnalyticsCategoriesStatusEl, "admin.analyticsLoading", "loading");
  try {
    const categories = await fetchAnalyticsCategories(startDate, endDate);
    if (generation !== analyticsGeneration || !analyticsState || requestId !== analyticsState.categories.requestId) return;
    section.cache.set(rangeKey, categories); section.data = categories; section.status = categories.length ? "success" : "empty";
    renderAnalyticsCategories(categories);
  } catch (error) {
    if (generation !== analyticsGeneration || !analyticsState || requestId !== analyticsState.categories.requestId) return;
    section.status = "error"; section.data = null;
    console.error("Gagal memuat kategori analitik:", error);
    showAnalyticsSectionStatus(adminAnalyticsCategoriesStatusEl, "admin.analyticsError", "error");
  }
}

// Dipanggil setiap kali nav "Analitik" diklik. Bagian yang sudah "success"
// tidak di-fetch ulang; bagian yang masih "idle" (baru) atau "error" (gagal
// sebelumnya) dicoba lagi. Tiga fetch berjalan independen lewat
// Promise.allSettled supaya satu kegagalan tidak membatalkan yang lain.
function ensureAnalyticsLoaded() {
  if (!analyticsState) analyticsState = createAnalyticsState();
  const generation = analyticsGeneration;
  const tasks = [];
  if (analyticsState.summary.status === "idle" || analyticsState.summary.status === "error") {
    tasks.push(loadAnalyticsSummary(generation));
  }
  if (analyticsState.products.status === "idle" || analyticsState.products.status === "error") {
    tasks.push(loadAnalyticsProducts(generation));
  }
  if (analyticsState.categories.status === "idle" || analyticsState.categories.status === "error") {
    tasks.push(loadAnalyticsCategories(generation));
  }
  if (analyticsState.trend.status === "idle" || analyticsState.trend.status === "error") {
    tasks.push(loadSalesTrend(generation));
  }
  if (analyticsState.forecast.status === "idle") {
    tasks.push(loadForecast(generation));
  }
  if (tasks.length > 0) Promise.allSettled(tasks);
}

adminSalesTrendFormEl.addEventListener("submit", (event) => {
  event.preventDefault();
  const startDate = adminSalesTrendStartEl.value;
  const endDate = adminSalesTrendEndEl.value;
  if (!analyticsState || !analyticsState.minAvailableDate || !isIsoCalendarDate(startDate) || !isIsoCalendarDate(endDate) || startDate > endDate ||
      startDate < analyticsState.minAvailableDate || endDate > analyticsState.maxAvailableDate) {
    showAnalyticsSectionStatus(adminSalesTrendStatusEl, "admin.salesTrendInvalid", "error");
    (startDate > endDate ? adminSalesTrendStartEl : (!isIsoCalendarDate(startDate) ? adminSalesTrendStartEl : adminSalesTrendEndEl)).focus();
    return;
  }
  analyticsState.appliedStartDate = startDate; analyticsState.appliedEndDate = endDate;
  renderAvailablePeriod(); closeCalendar(startCalendar); closeCalendar(endCalendar);
  const generation = analyticsGeneration;
  Promise.allSettled([
    loadAnalyticsSummary(generation, startDate, endDate),
    loadSalesTrend(generation, startDate, endDate),
    loadAnalyticsProducts(generation, startDate, endDate),
    loadAnalyticsCategories(generation, startDate, endDate),
  ]);
});

// ----------------------------------------------------------
// 9b. RENDER TAMPILAN NAVBAR SESUAI STATUS LOGIN
// ----------------------------------------------------------
// Menentukan mana dari dua elemen sibling (#authLoginBtn vs #authAccount)
// yang kena class "hide" - pola toggle yang sama seperti .cart-hint.hide,
// bukan mekanisme show/hide baru. Juga menampilkan/menyembunyikan tombol
// "+ Tambah Produk" (#adminMenuActions) dan dashboard tergantung role.
function updateAdminProductTotal() {
  const lang = document.documentElement.lang;
  if (productsLoadState === "success" || productsLoadState === "empty") {
    adminTotalProducts.textContent = String(productsById.size);
  } else {
    const key = productsLoadState === "error" ? "admin.productsUnavailable" : "admin.productsLoading";
    adminTotalProducts.textContent = translations[lang][key];
  }
}

function renderAuthUI() {
  const isLoggedIn = !!currentUser;
  authLoginBtn.classList.toggle("hide", isLoggedIn);
  authAccount.classList.toggle("hide", !isLoggedIn);
  if (isLoggedIn) authEmailText.textContent = currentUser.email;

  const isAdmin = isLoggedIn && currentUser.role === "admin";
  adminMenuActions.classList.toggle("hide", !isAdmin);
  adminDashboardEntry.hidden = !isAdmin;
  adminDashboard.hidden = !isAdmin;

  // Analitik terikat ke identitas admin efektif: logout, role turun, atau
  // ganti akun admin lain semuanya harus membuang data analitik lama supaya
  // sesi admin berikutnya tidak pernah melihat sisa data admin sebelumnya.
  const effectiveAdminUserId = isAdmin ? currentUser.id : null;
  if (effectiveAdminUserId !== analyticsAdminUserId) {
    analyticsGeneration += 1;
    analyticsState = null;
    resetAnalyticsDom();
    analyticsAdminUserId = effectiveAdminUserId;
  }

  // Kontrol Edit/Hapus dibuat langsung di dalam kartu saat role admin aktif.
  // Cabut segera ketika role efektif bukan admin; jangan menunggu loadMenu()
  // berhasil, karena fetch produk yang gagal sengaja mempertahankan kartu lama.
  if (!isAdmin) {
    document.querySelectorAll(".menu-card-admin").forEach((controls) => controls.remove());
  }

  if (isAdmin) {
    adminHeaderEmail.textContent = currentUser.email;
    adminCurrentRole.textContent = currentUser.role;
    adminLoggedInEmail.textContent = currentUser.email;
    updateAdminProductTotal();
  } else {
    adminHeaderEmail.textContent = "";
    adminCurrentRole.textContent = "";
    adminLoggedInEmail.textContent = "";
  }
}

// Navigation tetap memakai anchor ke section single-page yang sudah ada.
// Active state membantu orientasi visual/aksesibilitas tanpa menambah router.
function setActiveAdminNavigation(activeLink) {
  adminNavLinks.forEach((link) => {
    const isActive = link === activeLink;
    link.classList.toggle("active", isActive);
    if (isActive) link.setAttribute("aria-current", "location");
    else link.removeAttribute("aria-current");
  });
}

function syncAdminNavigationWithHash() {
  const activeLink = Array.from(adminNavLinks).find((link) => link.hash === window.location.hash) || null;
  setActiveAdminNavigation(activeLink);
}

adminNavLinks.forEach((link) => {
  link.addEventListener("click", () => {
    if (link.dataset.adminDestination === "dashboard") {
      requestAnimationFrame(() => adminOverview.focus());
    } else if (link.dataset.adminDestination === "analytics") {
      requestAnimationFrame(() => adminAnalytics.focus());
      ensureAnalyticsLoaded();
    }
  });
});

adminDashboardEntry.addEventListener("click", () => {
  requestAnimationFrame(() => adminOverview.focus());
});

window.addEventListener("hashchange", syncAdminNavigationWithHash);
syncAdminNavigationWithHash();

// ----------------------------------------------------------
// 9c. CEK STATUS LOGIN SAAT HALAMAN DIMUAT
// ----------------------------------------------------------
// Dipanggil sekali di akhir bagian ini (lihat pemanggilan di paling bawah),
// sejajar dengan pemanggilan loadMenu() di bagian 3c. GET /api/auth/me
// membaca cookie sesi (dikirim otomatis lewat "credentials: 'include'') dan
// membalas 200 + data user kalau valid, atau 401 kalau tidak/belum login.
function isValidAuthUser(user) {
  return (
    typeof user === "object" &&
    user !== null &&
    !Array.isArray(user) &&
    Number.isInteger(user.id) &&
    user.id > 0 &&
    typeof user.email === "string" &&
    user.email.trim().length > 0 &&
    (user.role === "user" || user.role === "admin")
  );
}

function activateGuestCart(snapshot) {
  cartHasUnsyncedChanges = false;
  setCartAuthority("guest");
  replaceCartItems(snapshot);
}

async function activateAuthenticatedCart(user, loginTransition = null) {
  if (cartAuthority !== "auth-transition") setCartAuthority("authenticated-loading");
  const expectedEpoch = cartEpoch;
  const storedIntent = readPendingCartMerge();
  let pending = storedIntent;

  if (loginTransition) {
    pending = {
      kind: "unbound",
      loginEmail: loginTransition.loginEmail,
      mergeId: loginTransition.mergeId,
      items: serializeCartItems(loginTransition.snapshot),
    };
  }

  if (pending && pending.kind === "unbound") {
    if (pending.loginEmail !== user.email.toLowerCase()) {
      pending = null;
    } else {
      pending = {
        kind: "bound",
        userId: user.id,
        mergeId: pending.mergeId,
        items: pending.items,
      };
      // userId berasal dari /api/auth/me yang baru diverifikasi, bukan storage.
      writePendingCartMerge(pending);
    }
  } else if (pending && pending.userId !== user.id) {
    pending = null;
  }

  if (pending && pending.kind !== "bound") {
    pending = null;
  }

  try {
    let canonical;
    if (pending && pending.userId === user.id && pending.items.length > 0) {
      canonical = (await mergeGuestCart(pending.mergeId, pending.items)).normalizedItems;
    } else {
      canonical = await fetchAuthenticatedCart();
    }
    if (cartEpoch !== expectedEpoch || !currentUser || currentUser.id !== user.id) return false;
    replaceCartItems(canonical);
    // Intent valid milik identitas lain tetap dipertahankan bersama guest
    // snapshot-nya; authenticated user saat ini tidak boleh mengklaimnya.
    if (!storedIntent || pending) clearGuestCartStorage();
    if (pending && pending.userId === user.id) clearPendingCartMerge();
    cartHasUnsyncedChanges = false;
    setCartAuthority("authenticated", user.id);
    hideAuthStatus();
    return true;
  } catch (error) {
    if (cartEpoch === expectedEpoch && currentUser && currentUser.id === user.id) {
      setCartAuthority("indeterminate");
      showAuthStatus("auth.genericError");
    }
    return false;
  }
}

async function checkAuthState(options = {}) {
  const reason = options.reason || "startup";
  const authCheckGeneration = ++cartAuthCheckGeneration;
  let result = "indeterminate";
  try {
    const response = await fetch(`${API_BASE_URL}/api/auth/me`, {
      credentials: "include",
    });

    if (authCheckGeneration !== cartAuthCheckGeneration) return "indeterminate";
    if (response.ok) {
      const data = await response.json();
      if (!data || !isValidAuthUser(data.user)) throw new Error("Respons status login tidak valid");
      currentUser = data.user;
      result = "authenticated";
    } else if (response.status === 401) {
      // 401 di sini BUKAN error yang perlu ditampilkan ke pengunjung -
      // artinya dia memang belum/tidak sedang login. Cukup dianggap anonim.
      currentUser = null;
      result = "anonymous";
    } else {
      // Status server tak terduga tidak membuktikan sesi sudah berakhir.
      // Pertahankan currentUser terakhir sampai /api/auth/me memberi jawaban
      // authoritative (200 atau 401) pada pemeriksaan berikutnya.
      console.error("Gagal memeriksa status login, status:", response.status);
    }
  } catch (error) {
    // Network/backend failure tidak sama dengan confirmed anonymous.
    // currentUser sengaja dipertahankan sebagai state terakhir yang diketahui.
    console.error("Gagal memeriksa status login:", error);
  }

  if (authCheckGeneration !== cartAuthCheckGeneration) return "indeterminate";

  renderAuthUI();

  if (result === "authenticated") {
    const activated = await activateAuthenticatedCart(currentUser, options.loginTransition || null);
    if (!activated) result = "indeterminate";
  } else if (result === "anonymous") {
    if (reason === "logout" || reason === "operation-401") {
      clearGuestCartStorage();
      clearPendingCartMerge();
      activateGuestCart(new Map());
    } else {
      activateGuestCart((options.loginTransition && options.loginTransition.snapshot) || options.guestSnapshot || initialGuestCartSnapshot);
    }
  } else {
    setCartAuthority("indeterminate");
  }

  // Kartu menu dari pemanggilan loadMenu() paling awal (bagian 3c) sudah
  // sempat dirender SEBELUM status login ini diketahui (fetch di atas perlu
  // waktu) - jadi kalau ternyata pengunjung ini admin, render ulang supaya
  // tombol Edit/Hapus muncul di tiap kartu.
  if (result === "authenticated" && currentUser.role === "admin") loadMenu();
  return result;
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

  const titleKey = isLogin ? "auth.loginTitle" : "auth.registerTitle";
  const submitKey = isLogin ? "auth.loginSubmit" : "auth.registerSubmit";
  const switchTextKey = isLogin ? "auth.noAccount" : "auth.haveAccount";
  const switchButtonKey = isLogin ? "auth.switchToRegister" : "auth.switchToLogin";
  authDialogTitle.dataset.i18n = titleKey;
  authSubmitBtn.dataset.i18n = submitKey;
  authSwitchText.dataset.i18n = switchTextKey;
  authSwitchModeBtn.dataset.i18n = switchButtonKey;
  authDialogTitle.textContent = translations[lang][titleKey];
  authSubmitBtn.textContent = translations[lang][submitKey];
  authSwitchText.textContent = translations[lang][switchTextKey];
  authSwitchModeBtn.textContent = translations[lang][switchButtonKey];
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
  const submittedMode = authMode;
  const endpoint = submittedMode === "login" ? "/api/auth/login" : "/api/auth/register";
  const loginMergeId = submittedMode === "login" && cartAuthority === "guest" ? createCartMergeId() : null;

  authSubmitBtn.disabled = true;
  authSwitchModeBtn.disabled = true;
  authForm.setAttribute("aria-busy", "true");
  const loadingKey = submittedMode === "login" ? "auth.loginLoading" : "auth.registerLoading";
  authSubmitBtn.dataset.i18n = loadingKey;
  authSubmitBtn.textContent = translations[lang][loadingKey];
  try {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ email, password }),
    });
    if (!response.ok) {
      let errorKey = "auth.genericError";
      if (response.status === 429) errorKey = "auth.rateLimited";
      else if (submittedMode === "login" && response.status === 401) errorKey = "auth.invalidCredentials";
      else if (submittedMode === "register" && response.status === 409) errorKey = "auth.emailExists";
      else if (response.status === 400) errorKey = "auth.invalidInput";
      showFormMessage(authFormMessage, translations[lang][errorKey], "error", errorKey);
      return;
    }

    if (submittedMode === "register") {
      // Daftar berhasil TIDAK otomatis login (backend cuma membuat akun,
      // belum membuat sesi/cookie) - pindahkan ke mode login supaya
      // pengunjung lanjut masuk pakai akun yang baru saja dibuat, alih-alih
      // menutup dialog begitu saja seolah-olah sudah login.
      setAuthMode("login");
      authForm.reset();
      authEmailInput.value = email;
      showFormMessage(authFormMessage, translations[lang]["auth.registerSuccess"], "success", "auth.registerSuccess");
      return;
    }

    // Login cookie sudah dibuat. Ambil snapshot TERBARU secara sinkron,
    // durable-kan sebagai intent yang belum terikat user, lalu kunci cart
    // sebelum /api/auth/me membuka window async berikutnya.
    const loginTransition = loginMergeId ? {
      snapshot: new Map(cartItems),
      mergeId: loginMergeId,
      loginEmail: email.toLowerCase(),
    } : null;
    if (loginTransition) {
      loginTransition.intentDurable = writePendingCartMerge({
        kind: "unbound",
        loginEmail: loginTransition.loginEmail,
        mergeId: loginTransition.mergeId,
        items: serializeCartItems(loginTransition.snapshot),
      });
      if (!loginTransition.intentDurable) showAuthStatus("auth.genericError");
    }
    setCartAuthority("auth-transition");

    // Login berhasil - cookie sesi sudah diset browser lewat header
    // Set-Cookie di response ini. checkAuthState() dipanggil ulang supaya
    // currentUser terisi LENGKAP dengan role (endpoint login sendiri cuma
    // membalas {id, email}, role baru diketahui lewat GET /api/auth/me).
    authDialog.close();
    authForm.reset();
    const authResult = await checkAuthState({ reason: "login", loginTransition });
    if (authResult !== "authenticated") showAuthStatus("auth.verifyError");
    else hideAuthStatus();
  } catch (error) {
    console.error("Gagal menghubungi server saat login/daftar:", error);
    showFormMessage(authFormMessage, translations[lang]["auth.genericError"], "error", "auth.genericError");
  } finally {
    authSubmitBtn.disabled = false;
    authSwitchModeBtn.disabled = false;
    authForm.setAttribute("aria-busy", "false");
    const submitKey = authMode === "login" ? "auth.loginSubmit" : "auth.registerSubmit";
    authSubmitBtn.dataset.i18n = submitKey;
    authSubmitBtn.textContent = translations[document.documentElement.lang][submitKey];
  }
});

// ----------------------------------------------------------
// 9e. LOGOUT
// ----------------------------------------------------------
let logoutPending = false;

async function handleLogout() {
  if (logoutPending) return;
  logoutPending = true;
  hideAuthStatus();
  const loadingKey = "auth.logoutLoading";
  [authLogoutBtn, adminLogoutBtn].forEach((button) => {
    button.disabled = true;
    button.dataset.i18n = loadingKey;
    button.textContent = translations[document.documentElement.lang][loadingKey];
  });
  let logoutRequestAttempted = false;

  try {
    const drained = await drainAuthenticatedCartWritesForLogout();
    if (!drained) {
      showAuthStatus("auth.logoutError");
      return;
    }
    setCartAuthority("auth-transition");
    logoutRequestAttempted = true;
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
    if (logoutRequestAttempted) {
      const authResult = await checkAuthState({ reason: "logout" });
      await loadMenu();
      if (authResult !== "anonymous") showAuthStatus("auth.logoutError");
    }
    logoutPending = false;
    [authLogoutBtn, adminLogoutBtn].forEach((button) => {
      button.disabled = false;
      button.dataset.i18n = "auth.logoutBtn";
      button.textContent = translations[document.documentElement.lang]["auth.logoutBtn"];
    });
  }
}

authLogoutBtn.addEventListener("click", handleLogout);
adminLogoutBtn.addEventListener("click", handleLogout);

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
  hideMenuStatus();

  if (mode === "edit") {
    productDialogTitle.dataset.i18n = "admin.editProductTitle";
    productSubmitBtn.dataset.i18n = "admin.editProductSubmit";
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
    productDialogTitle.dataset.i18n = "admin.addProductTitle";
    productSubmitBtn.dataset.i18n = "admin.addProductSubmit";
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
// memakai #productFormMessage, sedangkan delete memakai #menuStatus.
function handleAdminAuthError(response, showMessage) {
  const lang = document.documentElement.lang;
  if (response.status === 401) {
    currentUser = null;
    renderAuthUI();
    const message = translations[lang]["auth.sessionExpired"];
    showMessage(message, "auth.sessionExpired");
    loadMenu().then(() => showMessage(translations[document.documentElement.lang]["auth.sessionExpired"], "auth.sessionExpired"));
    return true;
  }
  if (response.status === 403) {
    showMessage(translations[lang]["admin.permissionDenied"], "admin.permissionDenied");
    return true;
  }
  if (response.status === 429) {
    showMessage(translations[lang]["admin.rateLimited"], "admin.rateLimited");
    return true;
  }
  return false;
}

productForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  hideFormMessage(productFormMessage);
  hideMenuStatus();
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
  productForm.setAttribute("aria-busy", "true");
  const loadingKey = isEdit ? "admin.editProductLoading" : "admin.addProductLoading";
  productSubmitBtn.dataset.i18n = loadingKey;
  productSubmitBtn.textContent = translations[lang][loadingKey];
  try {
    const response = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });

    if (handleAdminAuthError(response, (msg, key) => showFormMessage(productFormMessage, msg, "error", key))) return;

    if (!response.ok) {
      const errorKey = response.status === 400 || response.status === 409 ? "admin.validationError" : "admin.genericError";
      showFormMessage(productFormMessage, translations[lang][errorKey], "error", errorKey);
      return;
    }

    // Sukses (201 untuk tambah baru, 200 untuk edit) - tutup dialog, lalu
    // ambil ulang daftar produk dari server alih-alih menyisipkan/mengubah
    // kartu secara manual, supaya DOM selalu sinkron dengan sumber kebenaran
    // (prinsip yang sama seperti loadMenu() dipakai di banyak tempat lain).
    productDialog.close();
    const refreshed = await loadMenu();
    if (refreshed) {
      showMenuStatus(isEdit ? "admin.editSuccess" : "admin.addSuccess", "success", true);
      menuStatus.focus();
    }
  } catch (error) {
    console.error("Gagal menghubungi server saat menyimpan produk:", error);
    showFormMessage(productFormMessage, translations[lang]["admin.genericError"], "error", "admin.genericError");
  } finally {
    productSubmitBtn.disabled = false;
    productForm.setAttribute("aria-busy", "false");
    const submitKey = isEdit ? "admin.editProductSubmit" : "admin.addProductSubmit";
    productSubmitBtn.dataset.i18n = submitKey;
    productSubmitBtn.textContent = translations[document.documentElement.lang][submitKey];
  }
});

// ----------------------------------------------------------
// 9g. HAPUS PRODUK (ADMIN)
// ----------------------------------------------------------
// confirm() bawaan browser dipakai di sini (bukan dialog kustom) - ini aksi
// admin dengan cakupan minimal. Status request dan hasilnya ditampilkan di
// #menuStatus karena tombol Hapus berada langsung di kartu menu.
async function handleDeleteProduct(productId, deleteButton) {
  const lang = document.documentElement.lang;
  const product = productsById.get(productId);
  const confirmText = translations[lang]["admin.deleteConfirm"] + (product ? ` (${product.name})` : "");
  if (!confirm(confirmText)) return;

  hideMenuStatus();
  deleteButton.disabled = true;
  deleteButton.dataset.i18n = "admin.deleteLoading";
  deleteButton.textContent = translations[lang]["admin.deleteLoading"];
  try {
    const response = await fetch(`${API_BASE_URL}/api/products/${productId}`, {
      method: "DELETE",
      credentials: "include",
    });

    if (handleAdminAuthError(response, (msg, key) => showMenuStatus(key, "error"))) return;

    if (!response.ok) {
      showMenuStatus("admin.genericError", "error");
      return;
    }

    // Sukses = 204 No Content - TIDAK ADA body sama sekali untuk di-parse di
    // response ini (beda dari POST/PUT di atas yang membalas JSON). Langsung
    // ambil ulang daftar produk dari server, sama seperti pola sukses
    // create/edit di atas.
    const refreshed = await loadMenu();
    if (refreshed) {
      showMenuStatus("admin.deleteSuccess", "success", true);
      menuStatus.focus();
    }
  } catch (error) {
    console.error("Gagal menghubungi server saat menghapus produk:", error);
    showMenuStatus("admin.genericError", "error");
  } finally {
    if (deleteButton.isConnected) {
      deleteButton.disabled = false;
      deleteButton.dataset.i18n = "admin.deleteBtn";
      deleteButton.textContent = translations[document.documentElement.lang]["admin.deleteBtn"];
    }
  }
}

// Cek status login begitu halaman dimuat - sejajar dengan pemanggilan
// loadMenu() di bagian 3c. Diletakkan di baris paling akhir file supaya
// SEMUA fungsi & elemen yang dipakainya di atas (renderAuthUI, loadMenu,
// dst) sudah pasti selesai didefinisikan lebih dulu.
loadMenu();
checkAuthState();
