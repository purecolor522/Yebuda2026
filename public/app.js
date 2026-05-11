let products = [];
let cart = [];
let wishlist = new Set(JSON.parse(localStorage.getItem('yebuda_wishlist')) || []);
let currentCustomer = null;

// ===== AUTH HELPERS =====
function getToken() { return localStorage.getItem('yebuda_token'); }
function authHeaders() { const t = getToken(); return t ? { 'Content-Type': 'application/json', 'Authorization': `Bearer ${t}` } : { 'Content-Type': 'application/json' }; }

async function restoreSession() {
  const token = getToken();
  if (!token) return;
  // Idle-timeout check before honoring the stored token: if the user hasn't
  // touched the site for IDLE_TIMEOUT_MS, treat it as a session expiry.
  if (isIdleExpired()) {
    localStorage.removeItem('yebuda_token');
    localStorage.removeItem('yebuda_last_activity');
    return;
  }
  try {
    const res = await fetch('/api/auth/me', { headers: { 'Authorization': `Bearer ${token}` } });
    if (res.ok) {
      currentCustomer = await res.json();
      updateMemberUI();
      stampActivity();          // mark a fresh activity on successful restore
      // Restore wishlist from server snapshot if local is empty (e.g. new device same account)
      if (Array.isArray(currentCustomer.savedWishlist) && wishlist.size === 0 && currentCustomer.savedWishlist.length) {
        currentCustomer.savedWishlist.forEach(id => wishlist.add(id));
        localStorage.setItem('yebuda_wishlist', JSON.stringify([...wishlist]));
        syncWishlistUI();
      }
    }
    else { localStorage.removeItem('yebuda_token'); }
  } catch {}
}

// ===== Idle auto-logout =====
// Customer is logged out automatically if they don't interact for IDLE_TIMEOUT_MS.
// To change the timeout, edit the constant below (millis).
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;          // 30 分鐘無動作就登出
const ACTIVITY_THROTTLE_MS = 10 * 1000;          // 最多 10 秒寫一次 localStorage
const IDLE_CHECK_INTERVAL_MS = 60 * 1000;        // 每分鐘檢查一次是否該登出
const LAST_ACTIVITY_KEY = 'yebuda_last_activity';

let lastActivityWrite = 0;

function stampActivity() {
  const now = Date.now();
  if (now - lastActivityWrite < ACTIVITY_THROTTLE_MS) return;
  lastActivityWrite = now;
  if (getToken()) localStorage.setItem(LAST_ACTIVITY_KEY, String(now));
}

function isIdleExpired() {
  if (!getToken()) return false;
  const raw = localStorage.getItem(LAST_ACTIVITY_KEY);
  if (!raw) return false;
  return (Date.now() - Number(raw)) > IDLE_TIMEOUT_MS;
}

async function checkIdleAndMaybeLogout() {
  if (!getToken() || !isIdleExpired()) return;
  await clearAllSessionData();
  try { showToast('閒置 30 分鐘已自動登出，歡迎再次登入 ✨'); } catch {}
}

// One place that fully resets the browser session: token, profile, cart, wishlist, UI.
// Called by both manual logout and idle auto-logout.
// BEFORE clearing: persist current cart + wishlist to the customer record so the
// same account gets them back on next login.
async function clearAllSessionData() {
  // 1. Snapshot current state to server (only if a token still exists)
  const token = getToken();
  if (token) {
    try {
      await fetch('/api/auth/save-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ wishlist: [...wishlist] }),
      });
    } catch {}
  }

  // 2. Token + activity
  localStorage.removeItem('yebuda_token');
  localStorage.removeItem(LAST_ACTIVITY_KEY);
  currentCustomer = null;

  // 3. Wishlist (localStorage)
  wishlist.clear();
  localStorage.removeItem('yebuda_wishlist');

  // 4. Cart (server-side, scoped by sid cookie) — clear so next anon visitor on
  //    this device sees an empty cart
  try {
    await fetch('/api/cart/all', { method: 'DELETE' });
  } catch {}
  cart = [];

  // 5. Refresh UI everywhere
  updateMemberUI();
  syncWishlistUI();
  setCartCountBadge(0);
  renderCart(0);

  // 6. Close any auth-dependent modals/drawers
  document.getElementById('authModal')?.classList.remove('show');
  document.getElementById('ordersModal')?.classList.remove('show');
  document.getElementById('orderDetailModal')?.classList.remove('show');
  document.getElementById('wishlistModal')?.classList.remove('show');
  document.getElementById('cartDrawer')?.classList.remove('open');
}

function initIdleAutoLogout() {
  // Bind passive listeners on common interaction events
  ['click', 'keydown', 'scroll', 'touchstart', 'mousemove'].forEach(ev =>
    document.addEventListener(ev, stampActivity, { passive: true })
  );
  // Periodic check
  setInterval(checkIdleAndMaybeLogout, IDLE_CHECK_INTERVAL_MS);
  // Check immediately in case tab was reopened after long idle
  checkIdleAndMaybeLogout();
}

function updateMemberUI() {
  const lbl = document.getElementById('memberLabel');
  if (currentCustomer) {
    lbl.textContent = currentCustomer.name ? currentCustomer.name.slice(0,1) : '✓';
    lbl.style.cssText = 'position:absolute;top:-6px;right:-8px;background:var(--accent);color:#fff;font-size:9px;width:16px;height:16px;border-radius:50%;display:flex;align-items:center;justify-content:center';
    const autofillBtn = document.getElementById('autofillBtn');
    if (autofillBtn) autofillBtn.style.display = 'block';
  } else {
    lbl.textContent = '';
    lbl.style.cssText = 'display:none';   // 完全隱藏，不留圓圈殘跡
    const autofillBtn = document.getElementById('autofillBtn');
    if (autofillBtn) autofillBtn.style.display = 'none';
  }
}

function openAuthModal() {
  const isLoggedIn = !!currentCustomer;
  // Always reset to login mode first so previous state (forgot/register) is cleared.
  setAuthMode('login');

  if (isLoggedIn) {
    // Member-area view: hide every login/register/forgot UI element + show profile
    document.getElementById('authForm').style.display = 'none';
    document.getElementById('forgotForm').style.display = 'none';
    document.getElementById('authSwitchText').parentElement.style.display = 'none';
    document.getElementById('forgotLink').style.display = 'none';
    document.getElementById('authModalTitle').textContent = '會員專區';
    document.getElementById('authUserPanel').style.display = 'block';
    document.getElementById('authUserName').textContent = currentCustomer.name || currentCustomer.email;
    renderProfileView();
    showProfileEdit(false);
  } else {
    document.getElementById('authUserPanel').style.display = 'none';
  }

  document.getElementById('authModal').classList.add('show');
}

function renderProfileView() {
  if (!currentCustomer) return;
  document.getElementById('pvEmail').textContent   = currentCustomer.email   || '—';
  document.getElementById('pvName').textContent    = currentCustomer.name    || '—';
  document.getElementById('pvPhone').textContent   = currentCustomer.phone   || '—';
  document.getElementById('pvAddress').textContent = currentCustomer.address || '—';
  const available = (currentCustomer.coupons || []).filter(c => !c.usedAt);
  const couponEl = document.getElementById('pvCoupons');
  if (available.length === 0) {
    couponEl.innerHTML = '<span style="color:#999">無可用</span>';
  } else {
    couponEl.innerHTML = available.map(c =>
      `<span style="display:inline-block;background:var(--accent);color:#fff;padding:2px 10px;border-radius:12px;margin-right:6px;font-size:11px">NT$${c.amount} ${c.reason || ''}</span>`
    ).join('');
  }
}

function showProfileEdit(open) {
  document.getElementById('profileView').style.display = open ? 'none' : 'block';
  document.getElementById('profileForm').style.display = open ? 'block' : 'none';
  document.getElementById('profileErr').style.display = 'none';
  if (open && currentCustomer) {
    document.getElementById('pfName').value    = currentCustomer.name    || '';
    document.getElementById('pfPhone').value   = currentCustomer.phone   || '';
    document.getElementById('pfAddress').value = currentCustomer.address || '';
  }
}

let authMode = 'login';
function setAuthMode(mode) {
  authMode = mode;
  const isRegister = mode === 'register';
  document.getElementById('authModalTitle').textContent = isRegister ? '註冊帳號' : '登入';
  document.getElementById('authSubmitBtn').textContent = isRegister ? '立即註冊' : '登入';
  document.getElementById('authSwitchText').textContent = isRegister ? '已有帳號？' : '還沒有帳號？';
  document.getElementById('authSwitchBtn').textContent = isRegister ? '立即登入' : '立即註冊';
  document.getElementById('registerExtra').style.display = isRegister ? 'block' : 'none';
  document.getElementById('authErr').style.display = 'none';
  // Forgot link only visible in login mode
  document.getElementById('forgotLink').style.display = isRegister ? 'none' : 'block';
  // Always exit forgot mode when toggling between login/register
  showForgotForm(false);
}

function showForgotForm(open) {
  document.getElementById('authForm').style.display       = open ? 'none' : 'block';
  document.getElementById('forgotForm').style.display     = open ? 'block' : 'none';
  document.getElementById('authSwitchText').parentElement.style.display = open ? 'none' : 'block';
  document.getElementById('forgotLink').style.display     = open ? 'none' : (authMode === 'register' ? 'none' : 'block');
  document.getElementById('authModalTitle').textContent   = open ? '忘記密碼' : (authMode === 'register' ? '註冊帳號' : '登入');
  document.getElementById('forgotErr').style.display = 'none';
  document.getElementById('forgotMsg').style.display = 'none';
}

// Lookbook 顯示哪 4 個商品 — 直接從商品資料庫抓圖片與名稱，
// 因此「照片 = 該商品」，點下去自然開啟對應商品 modal。
// 想換成不同商品，改下面這 4 個 id 即可（後台商品管理頁可看 id）。
const LOOKBOOK_PRODUCT_IDS = ['y010', 'y001', 'y008', 'y011'];

const instaImages = ['22','23','25','11','12','13'].map(n => `images/LINE_ALBUM_2026424_260507_${n}.jpg`);

// ===== INIT =====
async function init() {
  try {
    const res = await fetch('/api/products');
    products = await res.json();
  } catch (e) {
    console.error('Failed to load products', e);
  }

  renderProducts('productGrid', products.slice(0, 8));
  renderProducts('bestGrid', products.filter(p => p.badge === 'BEST' || p.badge === 'HOT').slice(0, 4));
  renderLookbook();
  renderInsta();
  initHeroSlider();
  bindEvents();
  initScrollAnimations();
  await restoreSession();
  await loadCart();
  initIdleAutoLogout();
}

async function loadCart() {
  try {
    const res = await fetch('/api/cart');
    const data = await res.json();
    cart = data.items;
    renderCart(data.total);
  } catch (e) {
    console.error('Failed to load cart', e);
  }
}

// ===== RENDER PRODUCTS =====
function renderProducts(container, items) {
  const el = document.getElementById(container);
  el.innerHTML = items.map(p => {
    const orig = p.originalPrice || p.price;
    const discount = orig > p.price ? Math.round((1 - p.price / orig) * 100) : 0;
    const badgeClass = p.badge === 'NEW' ? 'badge-new' : p.badge === 'BEST' ? 'badge-best' : p.badge === 'HOT' ? 'badge-sale' : '';
    const wished = wishlist.has(p.id);
    const colorsHtml = (p.colors || []).map(c => `<span class="color-dot" style="background:${c}"></span>`).join('');
    
    return `<div class="product-card" data-id="${p.id}">
      <div class="product-img-wrap">
        <img src="${p.image}" alt="${p.name}" loading="lazy">
        ${p.badge ? `<span class="product-badge ${badgeClass}">${p.badge}</span>` : ''}
        <span class="product-wish ${wished ? 'active' : ''}" data-wish="${p.id}">${wished ? '❤️' : '♡'}</span>
      </div>
      <div class="product-info">
        <h3>${p.name}</h3>
        <div class="product-price">
          ${discount > 0 ? `<span class="price-original">NT$${orig.toLocaleString()}</span>` : ''}
          <span class="price-sale">NT$${p.price.toLocaleString()}</span>
          ${discount > 0 ? `<span class="price-discount">${discount}%</span>` : ''}
        </div>
        <div class="product-colors">${colorsHtml}</div>
      </div>
    </div>`;
  }).join('');
}

// ===== LOOKBOOK =====
// Pulls the actual product image + name + subtitle from the products catalog
// so each lookbook tile IS a real product. Clicking opens that product's modal.
function renderLookbook() {
  const items = LOOKBOOK_PRODUCT_IDS
    .map(id => products.find(p => p.id === id))
    .filter(Boolean);
  if (!items.length) {
    document.getElementById('lookbookGrid').innerHTML = '';
    return;
  }
  document.getElementById('lookbookGrid').innerHTML = items.map(p => `
    <div class="lookbook-item" data-product="${p.id}">
      <img src="${p.image}" alt="${p.name}" loading="lazy">
      <div class="lookbook-label">
        <h4>${p.name}</h4>
        <p>${p.subtitle || ''}</p>
      </div>
    </div>`).join('');
  document.querySelectorAll('.lookbook-item').forEach(el => {
    const id = el.dataset.product;
    el.addEventListener('click', () => openProductModal(id));
  });
}

// ===== INSTAGRAM =====
const IG_URL = 'https://www.instagram.com/yebuda22?igsh=MWZlZnd0NGJnZ2Zvcw==';
function renderInsta() {
  document.getElementById('instaGrid').innerHTML = instaImages.map(img =>
    `<a class="insta-item" href="${IG_URL}" target="_blank" rel="noopener" aria-label="到 Instagram @yebuda22">
      <img src="${img}" alt="Instagram" loading="lazy">
    </a>`
  ).join('');
}

// ===== HERO SLIDER =====
let heroIndex = 0;
function initHeroSlider() {
  const slides = document.querySelectorAll('.hero-slide');
  if(!slides.length) return;
  const dotsEl = document.getElementById('heroDots');
  slides.forEach((_, i) => {
    const dot = document.createElement('button');
    dot.className = `hero-dot${i === 0 ? ' active' : ''}`;
    dot.addEventListener('click', () => goSlide(i));
    dotsEl.appendChild(dot);
  });
  setInterval(() => goSlide((heroIndex + 1) % slides.length), 5000);
  document.getElementById('heroPrev').addEventListener('click', () => goSlide((heroIndex - 1 + slides.length) % slides.length));
  document.getElementById('heroNext').addEventListener('click', () => goSlide((heroIndex + 1) % slides.length));
}

function goSlide(i) {
  const slides = document.querySelectorAll('.hero-slide');
  const dots = document.querySelectorAll('.hero-dot');
  if(!slides.length) return;
  slides[heroIndex].classList.remove('active');
  dots[heroIndex].classList.remove('active');
  heroIndex = i;
  slides[heroIndex].classList.add('active');
  dots[heroIndex].classList.add('active');
}

// ===== EVENTS =====
function bindEvents() {
  // Category tabs
  document.querySelectorAll('.cat-tab').forEach(tab => {
    tab.addEventListener('click', () => filterProductsByGroup(tab.dataset.cat, true));
  });

  bindProductEvents();

  // Search
  document.getElementById('searchBtn').addEventListener('click', () => {
    document.getElementById('searchOverlay').classList.add('show');
    setTimeout(() => document.getElementById('searchInput').focus(), 300);
  });
  document.getElementById('searchClose').addEventListener('click', () => document.getElementById('searchOverlay').classList.remove('show'));
  document.getElementById('searchInput').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    const results = products.filter(p => p.name.toLowerCase().includes(q));
    const el = document.getElementById('searchResults');
    if (q.length < 1) { el.innerHTML = ''; return; }
    el.innerHTML = results.slice(0, 6).map(p =>
      `<div class="product-card" data-id="${p.id}" style="cursor:pointer"><div class="product-img-wrap"><img src="${p.image}" alt="${p.name}"></div><div class="product-info"><h3>${p.name}</h3><span class="price-sale">NT$${p.price.toLocaleString()}</span></div></div>`
    ).join('');
  });

  // Cart
  document.getElementById('cartBtn').addEventListener('click', () => document.getElementById('cartDrawer').classList.add('open'));
  document.getElementById('cartClose').addEventListener('click', () => document.getElementById('cartDrawer').classList.remove('open'));

  // Wishlist (top heart icon)
  document.getElementById('wishBtn').addEventListener('click', (e) => {
    e.preventDefault();
    openWishlistModal();
  });
  document.getElementById('wishlistClose').addEventListener('click', () =>
    document.getElementById('wishlistModal').classList.remove('show'));
  document.getElementById('wishlistModal').addEventListener('click', (e) => {
    if (e.target.id === 'wishlistModal') document.getElementById('wishlistModal').classList.remove('show');
  });
  updateWishCountBadge();

  // Modal
  document.getElementById('modalClose').addEventListener('click', () => document.getElementById('productModal').classList.remove('show'));
  document.getElementById('productModal').addEventListener('click', (e) => { if (e.target.id === 'productModal') document.getElementById('productModal').classList.remove('show'); });

  // Heart inside the product modal — toggles wishlist for the currently shown product
  document.getElementById('modalWishBtn').addEventListener('click', () => {
    const id = document.getElementById('modalWishBtn').dataset.id;
    if (id) toggleWish(id);
  });

  // Quantity
  let qty = 1;
  document.getElementById('qtyMinus').addEventListener('click', () => { if (qty > 1) { qty--; document.getElementById('qtyNum').textContent = qty; } });
  document.getElementById('qtyPlus').addEventListener('click', () => { qty++; document.getElementById('qtyNum').textContent = qty; });

  // Add to cart
  document.getElementById('addCartBtn').addEventListener('click', async () => {
    const id = document.getElementById('addCartBtn').dataset.id;
    const product = products.find(p => p.id === id);
    const size = document.querySelector('.size-btn.active')?.textContent || 'FREE';
    const q = parseInt(document.getElementById('qtyNum').textContent);
    
    await addToCart(product, size, q);
    
    document.getElementById('productModal').classList.remove('show');
    document.getElementById('cartDrawer').classList.add('open');
  });

  // Checkout flow
  document.getElementById('showCheckoutBtn').addEventListener('click', () => {
    if (cart.length === 0) { showToast('購物車是空的哦！'); return; }
    document.getElementById('cartBody').style.display = 'none';
    document.getElementById('checkoutFormContainer').style.display = 'block';
    // Pre-fill purchaser email from logged-in customer
    if (currentCustomer?.email && !document.getElementById('buyerEmail').value) {
      document.getElementById('buyerEmail').value = currentCustomer.email;
    }
    populateCouponSelect();
    updateCheckoutSummary();
    syncShippingMethodUI();
    syncPaymentMethodUI();
    syncRecipientUI();
  });

  // Recalculate summary when coupon changes
  document.getElementById('couponSelect').addEventListener('change', updateCheckoutSummary);

  // Shipping method radios drive both the address/CVS block visibility AND
  // whether the 超商取貨付款 payment option is shown
  document.querySelectorAll('input[name="shippingMethod"]').forEach(r => {
    r.addEventListener('change', () => syncShippingMethodUI());
  });

  // Payment method toggle (visual only — has no side effects on shipping)
  document.querySelectorAll('input[name="paymentMethod"]').forEach(r => {
    r.addEventListener('change', () => syncPaymentMethodUI());
  });

  // Same-as-purchaser toggle
  document.getElementById('sameAsPurchaser').addEventListener('change', () => syncRecipientUI());
  // Whenever purchaser fields change AND checkbox is on, mirror to recipient
  ['buyerName', 'buyerPhone'].forEach(id => {
    document.getElementById(id).addEventListener('input', () => {
      if (document.getElementById('sameAsPurchaser').checked) mirrorPurchaserToRecipient();
    });
  });

  // CVS picker — brand follows current shipping method
  document.getElementById('pickStoreBtn').addEventListener('click', () => {
    const brand = currentCvsBrand();
    if (brand) openCvsPicker(brand);
  });
  document.getElementById('cvsChangeBtn').addEventListener('click', (e) => {
    e.preventDefault();
    clearCvsSelection();
  });

  // Listen for store-picked messages from the iframe (or legacy popup)
  window.addEventListener('message', (e) => {
    if (e?.data?.type !== 'cvs-store-selected') return;
    applyCvsSelection(e.data.data);
    closeCvsPicker();
  });

  // CVS overlay close affordances
  document.getElementById('cvsMapClose').addEventListener('click', closeCvsPicker);
  document.getElementById('cvsMapOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'cvsMapOverlay') closeCvsPicker();
  });

  document.getElementById('backToCartBtn').addEventListener('click', () => {
    document.getElementById('cartBody').style.display = 'flex';
    document.getElementById('checkoutFormContainer').style.display = 'none';
  });

  // REAL CHECKOUT SUBMIT
  document.getElementById('checkoutForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('confirmOrderBtn') || e.submitter;
    if(btn) btn.disabled = true;
    
    const couponId = document.getElementById('couponSelect').value || undefined;
    const uiShip = document.querySelector('input[name="shippingMethod"]:checked')?.value || 'address';
    const payment = document.querySelector('input[name="paymentMethod"]:checked')?.value || 'ecpay';

    // Translate UI shipping → server fields
    let shippingMethod, cvsBrand, cvsStore, address;
    if (uiShip === 'address') {
      shippingMethod = 'address';
      address = document.getElementById('buyerAddress').value.trim();
      if (!address) {
        alert('請填寫收件地址');
        if (btn) btn.disabled = false;
        return;
      }
    } else {
      // cvs-711 or cvs-fami
      shippingMethod = 'cvs';
      cvsBrand = uiShip === 'cvs-711' ? '7-11' : '全家';
      cvsStore = document.getElementById('cvsStore').value;
      const storeId = document.getElementById('cvsStoreId').value;
      const storeAddr = document.getElementById('cvsStoreAddress').value;
      const pickedBrand = document.getElementById('cvsBrand').value;
      if (!cvsStore || pickedBrand !== cvsBrand) {
        alert(`請點擊上方按鈕選擇 ${cvsBrand} 取貨門市`);
        if (btn) btn.disabled = false;
        return;
      }
      address = `[${cvsBrand} ${cvsStore}${storeId ? ' #' + storeId : ''}] ${storeAddr}`;
    }

    // Recipient — mirror from purchaser when checkbox checked
    const sameAsPurchaser = document.getElementById('sameAsPurchaser').checked;
    const purchaserName  = document.getElementById('buyerName').value.trim();
    const purchaserPhone = document.getElementById('buyerPhone').value.trim();
    const purchaserEmail = document.getElementById('buyerEmail').value.trim();
    const recipientName  = sameAsPurchaser ? purchaserName  : document.getElementById('rcpName').value.trim();
    const recipientPhone = sameAsPurchaser ? purchaserPhone : document.getElementById('rcpPhone').value.trim();
    if (!recipientName || !recipientPhone) {
      alert('請填寫收貨人姓名與電話');
      if (btn) btn.disabled = false;
      return;
    }

    const payload = {
      // recipient (used for delivery — stays as `customer` on server for compat)
      name: recipientName,
      phone: recipientPhone,
      email: purchaserEmail || 'guest@example.com',
      address,
      // purchaser (orderer) — separate
      purchaser: { name: purchaserName, phone: purchaserPhone, email: purchaserEmail },
      shippingMethod,
      cvsBrand,
      cvsStore,
      payment,
      couponId,
    };

    try {
      const token = getToken();
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });
      const result = await res.json();

      if (!res.ok) throw new Error(result.error || 'Checkout failed');

      if (result.ecpayUrl) {
        // Full-page navigation to the redirect endpoint, which serves the
        // auto-submit ECPay form. This avoids the DOM-injection bug where
        // injecting full HTML into <body> caused the wrong form to submit.
        window.location.href = result.ecpayUrl;
        return;
      }
      // Legacy fallback for very old responses with redirectHtml
      if (result.redirectHtml) {
        document.open();
        document.write(result.redirectHtml);
        document.close();
        return;
      }

      // Refresh customer record so the used coupon disappears from the list
      if (token) {
        try {
          const me = await fetch('/api/auth/me', { headers: { 'Authorization': `Bearer ${token}` } });
          if (me.ok) currentCustomer = await me.json();
        } catch {}
      }

      const couponMsg = couponId ? ' （已使用 NT$100 折價券）' : '';
      showToast(`感謝 ${payload.name} 的訂購！訂單已建立 🎉${couponMsg}`);
      await loadCart();
      document.getElementById('checkoutForm').reset();
      document.getElementById('cartBody').style.display = 'flex';
      document.getElementById('checkoutFormContainer').style.display = 'none';
      document.getElementById('cartDrawer').classList.remove('open');
    } catch (err) {
      alert(err.message);
      if(btn) btn.disabled = false;
    }
  });

  // Mobile menu
  document.getElementById('hamburgerBtn').addEventListener('click', () => document.getElementById('mobileMenu').classList.add('open'));
  document.getElementById('mobileClose').addEventListener('click', () => document.getElementById('mobileMenu').classList.remove('open'));

  const closeMobile = () => document.getElementById('mobileMenu').classList.remove('open');
  document.getElementById('mobileAuthLink').addEventListener('click', (e) => {
    e.preventDefault(); closeMobile(); openAuthModal();
  });
  document.getElementById('mobileOrdersLink').addEventListener('click', (e) => {
    e.preventDefault(); closeMobile();
    if (currentCustomer) openOrdersDashboard();
    else { openAuthModal(); showToast('請先登入查看訂單'); }
  });
  document.getElementById('mobileWishLink').addEventListener('click', (e) => {
    e.preventDefault(); closeMobile();
    document.getElementById('wishBtn')?.click();
    if (!wishlist.size) showToast('您還沒有收藏任何商品');
    else showToast(`您收藏了 ${wishlist.size} 件商品`);
  });

  // Back to top
  const backTop = document.getElementById('backTop');
  window.addEventListener('scroll', () => { backTop.classList.toggle('show', window.scrollY > 500); });
  backTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

  // ESC key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.getElementById('searchOverlay').classList.remove('show');
      document.getElementById('productModal').classList.remove('show');
      document.getElementById('authModal').classList.remove('show');
      document.getElementById('ordersModal').classList.remove('show');
      document.getElementById('orderDetailModal')?.classList.remove('show');
      document.getElementById('policyModal')?.classList.remove('show');
      document.getElementById('wishlistModal')?.classList.remove('show');
      const cvsOverlay = document.getElementById('cvsMapOverlay');
      if (cvsOverlay && cvsOverlay.style.display === 'block') closeCvsPicker();
      document.getElementById('cartDrawer').classList.remove('open');
      document.getElementById('mobileMenu').classList.remove('open');
    }
  });

  // Member button
  document.getElementById('memberBtn').addEventListener('click', openAuthModal);
  document.getElementById('authModal').addEventListener('click', (e) => { if(e.target.id === 'authModal') document.getElementById('authModal').classList.remove('show'); });
  document.getElementById('ordersModal').addEventListener('click', (e) => { if(e.target.id === 'ordersModal') document.getElementById('ordersModal').classList.remove('show'); });
  document.getElementById('ordersModalClose').addEventListener('click', () => document.getElementById('ordersModal').classList.remove('show'));

  // Auth switch (login <-> register)
  document.getElementById('authSwitchBtn').addEventListener('click', (e) => {
    e.preventDefault();
    setAuthMode(authMode === 'login' ? 'register' : 'login');
  });

  // Forgot password — show forgot form, hide login form
  document.getElementById('authForgotBtn').addEventListener('click', (e) => {
    e.preventDefault();
    showForgotForm(true);
  });
  document.getElementById('forgotBackBtn').addEventListener('click', (e) => {
    e.preventDefault();
    showForgotForm(false);
  });

  // Forgot form submit
  document.getElementById('forgotForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('forgotErr');
    const msgEl = document.getElementById('forgotMsg');
    const btn = document.getElementById('forgotSubmitBtn');
    errEl.style.display = 'none';
    msgEl.style.display = 'none';
    btn.disabled = true;
    btn.textContent = '寄送中…';
    try {
      const email = document.getElementById('forgotEmail').value.trim();
      const res = await fetch('/api/auth/forgot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '發生錯誤');
      msgEl.textContent = `✓ ${data.message || '重設信件已寄出，請查收（含垃圾信匣）'}`;
      msgEl.style.display = 'block';
      document.getElementById('forgotEmail').value = '';
    } catch (err) {
      errEl.textContent = err.message;
      errEl.style.display = 'block';
    }
    btn.disabled = false;
    btn.textContent = '寄送重設連結';
  });

  // Auth form submit
  document.getElementById('authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('authErr');
    errEl.style.display = 'none';
    const email = document.getElementById('authEmail').value;
    const password = document.getElementById('authPassword').value;
    const body = authMode === 'register'
      ? { email, password, name: document.getElementById('authName').value, phone: document.getElementById('authPhone').value, address: document.getElementById('authAddress').value }
      : { email, password };
    try {
      const res = await fetch(`/api/auth/${authMode}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) {
        // Show error + inline "忘記密碼？" link when it's a credentials error in login mode
        const isCredErr = authMode === 'login' && /密碼|password/i.test(data.error || '');
        if (isCredErr) {
          errEl.innerHTML = `${data.error} · <a href="#" id="errForgotBtn" style="color:var(--accent);text-decoration:underline;">立即重設</a>`;
          // Wire the inline link
          setTimeout(() => {
            document.getElementById('errForgotBtn')?.addEventListener('click', (ev) => {
              ev.preventDefault();
              showForgotForm(true);
              // Pre-fill the email if user already typed one
              const emailVal = document.getElementById('authEmail').value.trim();
              if (emailVal) document.getElementById('forgotEmail').value = emailVal;
            });
          }, 0);
        } else {
          errEl.textContent = data.error;
        }
        errEl.style.display = 'block';
        return;
      }
      localStorage.setItem('yebuda_token', data.token);
      localStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()));   // start the idle timer
      currentCustomer = data.customer;
      updateMemberUI();

      // 還原帳號綁定的 wishlist + cart（登入時 server 已把 savedCart 寫回 sid cart）
      if (Array.isArray(data.customer.savedWishlist)) {
        wishlist.clear();
        data.customer.savedWishlist.forEach(id => wishlist.add(id));
        localStorage.setItem('yebuda_wishlist', JSON.stringify([...wishlist]));
        syncWishlistUI();
      }
      await loadCart();

      document.getElementById('authModal').classList.remove('show');
      showToast(authMode === 'register' ? `歡迎加入 ${data.customer.name || data.customer.email}！` : `歡迎回來！`);
    } catch { errEl.textContent = '連線錯誤，請稍後再試'; errEl.style.display = 'block'; }
  });

  // Logout — also clears cart + wishlist for privacy (next user/anon session starts clean)
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await clearAllSessionData();
    document.getElementById('authModal').classList.remove('show');
    showToast('已成功登出');
  });

  // View Orders → open dashboard
  document.getElementById('viewOrdersBtn').addEventListener('click', () => {
    document.getElementById('authModal').classList.remove('show');
    openOrdersDashboard();
  });

  // Dashboard tab + filter wiring
  document.querySelectorAll('#ordersTabs .ot-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#ordersTabs .ot-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      ordersState.tab = btn.dataset.tab;
      ordersState.page = 1;
      renderOrdersDashboard();
    });
  });
  ['orderTypeFilter', 'orderDateFilter'].forEach(id => {
    document.getElementById(id).addEventListener('change', () => {
      ordersState[id === 'orderTypeFilter' ? 'type' : 'days'] = document.getElementById(id).value;
      ordersState.page = 1;
      renderOrdersDashboard();
    });
  });
  document.getElementById('orderSearch').addEventListener('input', (e) => {
    ordersState.q = e.target.value.trim().toLowerCase();
    ordersState.page = 1;
    renderOrdersDashboard();
  });

  // Footer buttons
  document.getElementById('continueShoppingBtn').addEventListener('click', () => {
    document.getElementById('ordersModal').classList.remove('show');
    window.scrollTo({ top: document.getElementById('products')?.offsetTop || 0, behavior: 'smooth' });
  });
  document.getElementById('goMemberCenterBtn').addEventListener('click', () => {
    document.getElementById('ordersModal').classList.remove('show');
    openAuthModal();
  });

  // Order detail modal close
  document.getElementById('orderDetailClose').addEventListener('click', () =>
    document.getElementById('orderDetailModal').classList.remove('show'));
  document.getElementById('orderDetailModal').addEventListener('click', (e) => {
    if (e.target.id === 'orderDetailModal') document.getElementById('orderDetailModal').classList.remove('show');
  });

  // Profile edit
  document.getElementById('editProfileBtn').addEventListener('click', (e) => {
    e.preventDefault();
    showProfileEdit(true);
  });
  document.getElementById('cancelProfileBtn').addEventListener('click', () => showProfileEdit(false));
  document.getElementById('profileForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('profileErr');
    errEl.style.display = 'none';
    const body = {
      name:    document.getElementById('pfName').value.trim(),
      phone:   document.getElementById('pfPhone').value.trim(),
      address: document.getElementById('pfAddress').value.trim(),
    };
    try {
      const res = await fetch('/api/auth/me', {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { errEl.textContent = data.error || '更新失敗'; errEl.style.display = 'block'; return; }
      currentCustomer = data.customer;
      updateMemberUI();
      renderProfileView();
      showProfileEdit(false);
      showToast('資料已更新 ✨');
    } catch {
      errEl.textContent = '連線錯誤，請稍後再試';
      errEl.style.display = 'block';
    }
  });

  // Autofill checkout from profile (purchaser fields)
  document.getElementById('autofillBtn').addEventListener('click', () => {
    if (!currentCustomer) return;
    if (currentCustomer.name)  document.getElementById('buyerName').value  = currentCustomer.name;
    if (currentCustomer.phone) document.getElementById('buyerPhone').value = currentCustomer.phone;
    if (currentCustomer.email) document.getElementById('buyerEmail').value = currentCustomer.email;
    if (currentCustomer.address) {
      document.getElementById('buyerAddress').value = currentCustomer.address;
      // Saved address only applies if shipping is 宅配 — flip back if CVS was selected
      const addrRadio = document.querySelector('input[name="shippingMethod"][value="address"]');
      if (addrRadio && !addrRadio.checked) {
        addrRadio.checked = true;
        syncShippingMethodUI();
      }
    }
    if (document.getElementById('sameAsPurchaser').checked) mirrorPurchaserToRecipient();
    showToast('已帶入您的資料 ✨');
  });

  // ==== Shop links (footer + mobile menu) ====
  document.querySelectorAll('[data-shop]').forEach(a => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      // Close mobile menu if currently open (link clicked inside hamburger)
      document.getElementById('mobileMenu')?.classList.remove('open');
      const key = a.dataset.shop;
      if (key === 'best') {
        document.getElementById('bests')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      filterProductsByGroup(key, true);
      document.getElementById('products')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  // ==== Footer SUPPORT links → policy modal ====
  document.querySelectorAll('[data-policy]').forEach(a => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      openPolicyModal(a.dataset.policy);
    });
  });
  document.getElementById('policyClose').addEventListener('click', () =>
    document.getElementById('policyModal').classList.remove('show'));
  document.getElementById('policyModal').addEventListener('click', (e) => {
    if (e.target.id === 'policyModal') document.getElementById('policyModal').classList.remove('show');
  });
}

// ==== Category groups (homepage filter labels → DB categories) ====
const CAT_GROUPS = {
  all:    null,
  top:    ['blouse', 'tee', 'knit'],
  bottom: ['pants'],
  dress:  ['dress'],
  outer:  ['outer'],
  set:    ['set'],
  acc:    ['acc'],
  sale:   '__sale__',
};

function filterProductsByGroup(key, syncTab) {
  const group = CAT_GROUPS[key];
  let list;
  if (group === null) list = products.slice(0, 8);
  else if (group === '__sale__') list = products.filter(p => p.originalPrice && p.originalPrice > p.price);
  else if (Array.isArray(group)) list = products.filter(p => group.includes(p.category));
  else list = [];

  if (syncTab) {
    document.querySelectorAll('.cat-tab').forEach(t =>
      t.classList.toggle('active', t.dataset.cat === key));
  }

  const grid = document.getElementById('productGrid');
  if (!list.length) {
    grid.innerHTML = '<p style="grid-column:1/-1;text-align:center;color:#999;padding:60px 0">這個分類目前還沒有商品 — 看看其他分類吧</p>';
    return;
  }
  renderProducts('productGrid', list);
  bindProductEvents();
}

// ==== Policy modal content ====
const POLICY_CONTENT = {
  faq: {
    title: '常見問題',
    body: `
      <p style="margin-bottom:14px"><strong>Q1. 訂單成立後多久會出貨？</strong><br>
      週一至週五下午 3 點前完成付款的訂單，當日出貨；之後的訂單於下一個工作日出貨。</p>
      <p style="margin-bottom:14px"><strong>Q2. 可以更改訂單嗎？</strong><br>
      訂單尚未出貨前可透過 LINE @094efuba 聯絡我們調整；已出貨則無法更改。</p>
      <p style="margin-bottom:14px"><strong>Q3. 提供超商取貨嗎？</strong><br>
      目前提供宅配（黑貓宅急便）與 7-11 取貨付款兩種方式。</p>
      <p style="margin-bottom:14px"><strong>Q4. 商品實際顏色和照片有差嗎？</strong><br>
      因螢幕顯示與光線差異，實品顏色可能略有色差，以實品為準。介意者建議下單前 LINE 詢問細節。</p>
      <p><strong>Q5. 可以開立發票嗎？</strong><br>
      所有訂單皆會開立電子發票，於出貨後寄送至您填寫的 Email。</p>
    `,
  },
  return: {
    title: '退換貨政策',
    body: `
      <p style="margin-bottom:14px"><strong>七天鑑賞期</strong><br>
      依消保法規定，自您「收到商品的次日起算 7 日內」可申請退換貨。</p>
      <p style="margin-bottom:14px"><strong>退換貨條件</strong></p>
      <ul style="padding-left:20px;margin-bottom:14px">
        <li>商品須完整保留所有包裝、吊牌、贈品</li>
        <li>未經穿著、洗滌，無人為損壞、污漬、味道</li>
        <li>內衣褲、襪類等貼身衣物因衛生考量恕不接受退換</li>
        <li>特價、出清、客製商品恕不退換</li>
      </ul>
      <p style="margin-bottom:14px"><strong>退換貨流程</strong><br>
      1. LINE @094efuba 告知訂單編號與退貨原因<br>
      2. 客服確認後提供退貨地址<br>
      3. 自費寄回（換貨運費 YEBUDA 吸收）<br>
      4. 收到商品檢查後 5-7 個工作天完成退款</p>
      <p style="color:#999;font-size:12px">※ 鑑賞期非試用期，商品經穿著或破壞包裝即不符合退貨條件。</p>
    `,
  },
  shipping: {
    title: '運送說明',
    body: `
      <p style="margin-bottom:14px"><strong>運送方式</strong></p>
      <ul style="padding-left:20px;margin-bottom:14px">
        <li>黑貓宅配 — 全台 NT$80（滿 NT$2,000 免運）</li>
        <li>7-11 取貨付款 — NT$60（滿 NT$1,500 免運）</li>
      </ul>
      <p style="margin-bottom:14px"><strong>到貨時間</strong><br>
      出貨後本島 1-2 工作天、外島 3-5 工作天送達。週末及國定假日不出貨。</p>
      <p style="margin-bottom:14px"><strong>追蹤包裹</strong><br>
      出貨後系統會寄發 Email 通知，內含物流追蹤號。也可登入會員，於「我的訂單」查看狀態。</p>
      <p><strong>偏遠地區</strong><br>
      部分山區、外島可能酌收偏遠地區費用 NT$100，下單後客服會主動聯繫。</p>
    `,
  },
  contact: {
    title: '聯絡我們',
    body: `
      <p style="margin-bottom:18px">有任何問題歡迎透過以下方式聯絡 YEBUDA 客服 ✨</p>
      <div style="display:grid;gap:16px">
        <div style="display:flex;gap:14px;align-items:center;padding:14px;background:var(--bg);border-radius:6px">
          <span style="font-size:24px">💬</span>
          <div>
            <p style="font-weight:600;margin-bottom:2px">LINE 客服（最快）</p>
            <p style="color:#666">@094efuba — 回覆時間 11:00-17:00</p>
          </div>
        </div>
        <div style="display:flex;gap:14px;align-items:center;padding:14px;background:var(--bg);border-radius:6px">
          <span style="font-size:24px">📧</span>
          <div>
            <p style="font-weight:600;margin-bottom:2px">Email</p>
            <p style="color:#666">yebuda22@gmail.com — 1-2 個工作天內回覆</p>
          </div>
        </div>
        <div style="display:flex;gap:14px;align-items:center;padding:14px;background:var(--bg);border-radius:6px">
          <span style="font-size:24px">📷</span>
          <div>
            <p style="font-weight:600;margin-bottom:2px">Instagram</p>
            <p style="color:#666">@yebuda22 — 私訊也會回覆</p>
          </div>
        </div>
      </div>
      <p style="margin-top:18px;font-size:12px;color:#999">客服營業：週一至週五 11:00-17:00（午休 12:30-13:30）<br>週末及國定假日休息，您留言我們上班會盡快回覆。</p>
    `,
  },
};

function openPolicyModal(key) {
  const data = POLICY_CONTENT[key];
  if (!data) return;
  document.getElementById('policyTitle').textContent = data.title;
  document.getElementById('policyBody').innerHTML = data.body;
  document.getElementById('policyModal').classList.add('show');
}

function bindProductEvents() {
  document.querySelectorAll('.product-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.product-wish')) return;
      const id = card.dataset.id;
      openProductModal(id);
    });
  });
  document.querySelectorAll('.product-wish').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleWish(btn.dataset.wish);
    });
  });
}

function openProductModal(id) {
  const p = products.find(pr => pr.id === id);
  if (!p) return;
  document.getElementById('modalImg').src = p.image;
  document.getElementById('modalTitle').textContent = p.name;
  document.getElementById('modalDesc').textContent = p.description || p.subtitle || '';
  const orig = p.originalPrice || p.price;
  const discount = orig > p.price ? Math.round((1 - p.price / orig) * 100) : 0;
  
  document.getElementById('modalPrice').innerHTML = discount > 0 
    ? `<span style="text-decoration:line-through;color:#999;font-size:14px;font-weight:400;margin-right:8px">NT$${orig.toLocaleString()}</span>NT$${p.price.toLocaleString()} <span style="color:#e44;font-size:13px;margin-left:8px">${discount}% OFF</span>`
    : `NT$${p.price.toLocaleString()}`;
    
  // sizes
  const sizes = p.sizes || ['FREE'];
  document.getElementById('sizeSelector').innerHTML = sizes.map((s,i) => `<button class="size-btn ${i===0?'active':''}">${s}</button>`).join('');
  document.querySelectorAll('.size-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.size-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  document.getElementById('addCartBtn').dataset.id = id;
  document.getElementById('qtyNum').textContent = '1';

  // Sync the modal heart with current wishlist state
  const wishBtn = document.getElementById('modalWishBtn');
  wishBtn.dataset.id = id;
  const wished = wishlist.has(id);
  wishBtn.textContent = wished ? '❤️' : '♡';
  wishBtn.classList.toggle('active', wished);

  document.getElementById('productModal').classList.add('show');
}

function toggleWish(id) {
  const adding = !wishlist.has(id);
  if (adding) wishlist.add(id); else wishlist.delete(id);
  localStorage.setItem('yebuda_wishlist', JSON.stringify([...wishlist]));
  syncWishlistUI();
  showToast(adding ? '已加入收藏 ♡' : '已從收藏移除');
}

// Reflect the current wishlist Set in: product cards, product modal, top badge, wishlist modal.
function syncWishlistUI() {
  document.querySelectorAll('[data-wish]').forEach(el => {
    const wished = wishlist.has(el.dataset.wish);
    el.textContent = wished ? '❤️' : '♡';
    el.classList.toggle('active', wished);
  });
  const m = document.getElementById('modalWishBtn');
  if (m && m.dataset.id) {
    const wished = wishlist.has(m.dataset.id);
    m.textContent = wished ? '❤️' : '♡';
    m.classList.toggle('active', wished);
  }
  updateWishCountBadge();
  if (document.getElementById('wishlistModal').classList.contains('show')) renderWishlist();
}

function updateWishCountBadge() {
  const badge = document.getElementById('wishCountBadge');
  if (!badge) return;
  const n = wishlist.size;
  if (n > 0) { badge.textContent = n; badge.style.display = 'flex'; }
  else { badge.style.display = 'none'; }
}

function setCartCountBadge(n) {
  const badge = document.getElementById('cartCount');
  if (!badge) return;
  badge.textContent = String(n);
  badge.style.display = n > 0 ? 'flex' : 'none';
}

function openWishlistModal() {
  renderWishlist();
  document.getElementById('wishlistModal').classList.add('show');
}

function renderWishlist() {
  const body = document.getElementById('wishlistBody');
  const count = document.getElementById('wishCount');
  count.textContent = wishlist.size > 0 ? `(${wishlist.size})` : '';
  if (wishlist.size === 0) {
    body.innerHTML = `
      <div style="text-align:center;padding:50px 20px;color:#999">
        <div style="font-size:42px;margin-bottom:12px">♡</div>
        <p style="font-size:14px;margin-bottom:6px">還沒有收藏任何商品</p>
        <p style="font-size:12px">逛逛商品時點 ♡ 就能加入收藏</p>
      </div>`;
    return;
  }
  const items = [...wishlist].map(id => products.find(p => p.id === id)).filter(Boolean);
  if (items.length === 0) {
    body.innerHTML = '<p style="text-align:center;color:#999;padding:30px 0">收藏的商品已下架</p>';
    return;
  }
  body.innerHTML = `<div class="wishlist-grid">${items.map(p => {
    const orig = p.originalPrice || p.price;
    const discount = orig > p.price ? Math.round((1 - p.price / orig) * 100) : 0;
    return `<div class="wishlist-item" data-id="${p.id}">
      <div class="wishlist-img-wrap">
        <img src="${p.image}" alt="${p.name}">
        <button class="wishlist-remove" data-id="${p.id}" aria-label="移除收藏">✕</button>
      </div>
      <div class="wishlist-info">
        <h3>${p.name}</h3>
        <div class="product-price" style="margin-top:4px">
          ${discount > 0 ? `<span class="price-original">NT$${orig.toLocaleString()}</span>` : ''}
          <span class="price-sale">NT$${p.price.toLocaleString()}</span>
        </div>
        <button class="wishlist-view" data-id="${p.id}">查看商品</button>
      </div>
    </div>`;
  }).join('')}</div>`;

  body.querySelectorAll('.wishlist-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      wishlist.delete(id);
      localStorage.setItem('yebuda_wishlist', JSON.stringify([...wishlist]));
      updateWishCountBadge();
      // Sync any visible heart icon on the homepage product cards
      document.querySelectorAll(`[data-wish="${id}"]`).forEach(h => {
        h.textContent = '♡'; h.classList.remove('active');
      });
      renderWishlist();
      showToast('已從收藏移除');
    });
  });

  body.querySelectorAll('.wishlist-view').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('wishlistModal').classList.remove('show');
      openProductModal(btn.dataset.id);
    });
  });
}

// ===== CART =====
async function addToCart(product, size, qty) {
  try {
    const res = await fetch('/api/cart', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: product.id, size, color: product.color || '', qty })
    });
    if (res.ok) {
      await loadCart();
      showToast(`已加入購物車：${product.name}`);
    } else {
      const data = await res.json();
      showToast(data.error || '加入失敗');
    }
  } catch(e) { console.error(e); }
}

async function removeFromCart(productId, size, color) {
  try {
    const res = await fetch('/api/cart', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId, size, color })
    });
    if (res.ok) await loadCart();
  } catch(e) { console.error(e); }
}

function renderCart(total = 0) {
  const el = document.getElementById('cartItems');
  if (cart.length === 0) {
    el.innerHTML = '<p style="text-align:center;padding:40px 0;color:#999">購物車是空的</p>';
    document.getElementById('cartTotal').textContent = 'NT$0';
    setCartCountBadge(0);
    return;
  }
  el.innerHTML = cart.map((item) => {
    const sizeOpts = (item.availableSizes || ['FREE'])
      .map(s => `<option value="${s}" ${s === item.size ? 'selected' : ''}>${s}</option>`).join('');
    const colors = item.availableColors || [];
    const colorSelect = colors.length > 1
      ? `<select class="ci-color-select" aria-label="顏色">${colors.map(c => `<option value="${c}" ${c === item.color ? 'selected' : ''}>${c}</option>`).join('')}</select>`
      : (item.color ? `<span class="ci-color-static">${item.color}</span>` : '');

    return `<div class="cart-item" data-pid="${item.productId}" data-size="${item.size}" data-color="${item.color}">
      <img src="${item.image}" alt="${item.name}">
      <div class="cart-item-info">
        <h4>${item.name}</h4>
        <div class="ci-controls">
          <select class="ci-size-select" aria-label="尺寸">${sizeOpts}</select>
          ${colorSelect}
        </div>
        <div class="ci-qty-row">
          <div class="ci-qty">
            <button class="ci-qty-btn" data-dir="-1" aria-label="減少">−</button>
            <span class="ci-qty-num">${item.qty}</span>
            <button class="ci-qty-btn" data-dir="+1" aria-label="增加">+</button>
          </div>
          <div class="ci-price">NT$${item.subtotal.toLocaleString()}</div>
        </div>
      </div>
      <span class="cart-item-remove" aria-label="移除">✕</span>
    </div>`;
  }).join('');

  document.getElementById('cartTotal').textContent = `NT$${total.toLocaleString()}`;
  setCartCountBadge(cart.reduce((s, c) => s + c.qty, 0));

  // Bind per-line handlers
  document.querySelectorAll('.cart-item').forEach(row => {
    const pid     = row.dataset.pid;
    const size    = row.dataset.size;
    const color   = row.dataset.color;
    const item    = cart.find(c => c.productId === pid && c.size === size && c.color === color);
    if (!item) return;

    // Remove
    row.querySelector('.cart-item-remove').addEventListener('click', () => {
      removeFromCart(pid, size, color);
    });

    // Qty − / +
    row.querySelectorAll('.ci-qty-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const dir = Number(btn.dataset.dir);
        const next = item.qty + dir;
        if (next < 1) {
          if (confirm('要從購物車移除這項商品嗎？')) removeFromCart(pid, size, color);
        } else {
          updateCartQty(pid, size, color, next);
        }
      });
    });

    // Size change
    const sizeSel = row.querySelector('.ci-size-select');
    sizeSel?.addEventListener('change', () => {
      changeCartVariant(pid, size, color, sizeSel.value, color);
    });

    // Color change
    const colorSel = row.querySelector('.ci-color-select');
    colorSel?.addEventListener('change', () => {
      changeCartVariant(pid, size, color, size, colorSel.value);
    });
  });
}

async function updateCartQty(productId, size, color, qty) {
  try {
    const res = await fetch('/api/cart', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId, size, color, qty }),
    });
    if (res.ok) await loadCart();
    else { const d = await res.json(); showToast(d.error || '更新失敗'); }
  } catch (e) { console.error(e); }
}

async function changeCartVariant(productId, oldSize, oldColor, newSize, newColor) {
  if (oldSize === newSize && oldColor === newColor) return;
  try {
    const res = await fetch('/api/cart/variant', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId, oldSize, oldColor, newSize, newColor }),
    });
    if (res.ok) {
      await loadCart();
      showToast('購物車已更新');
    } else {
      const d = await res.json();
      showToast(d.error || '更新失敗');
      await loadCart(); // re-render to revert dropdowns
    }
  } catch (e) { console.error(e); await loadCart(); }
}

// ===== TOAST =====
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

// ===== SCROLL ANIMATIONS =====
function initScrollAnimations() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => { if (entry.isIntersecting) { entry.target.classList.add('visible'); observer.unobserve(entry.target); } });
  }, { threshold: 0.1 });
  document.querySelectorAll('.fade-in').forEach(el => observer.observe(el));
}

// ===== ORDERS DASHBOARD =====
const ordersState = {
  raw: [],          // all orders for current customer
  tab: 'all',
  type: 'all',
  days: 'all',
  q: '',
  page: 1,
  pageSize: 8,
};

const STATUS_MAP = {
  awaiting_payment: { label: '待付款',     cls: 'status-pending' },
  paid:             { label: '訂單成立',   cls: 'status-success' },
  processing:       { label: '處理中',     cls: 'status-pending' },
  shipped:          { label: '已出貨',     cls: 'status-shipped' },
  in_transit:       { label: '待簽收',     cls: 'status-transit' },
  delivered:        { label: '已取件',     cls: 'status-done'    },
  refund_requested: { label: '退貨申請中', cls: 'status-refund'  },
  refunded:         { label: '已退貨',     cls: 'status-refund'  },
  payment_failed:   { label: '付款失敗',   cls: 'status-cancel'  },
  cancelled:        { label: '已取消',     cls: 'status-cancel'  },
};

const PAYMENT_LABEL = {
  ecpay:        '信用卡（綠界）',
  'cvs-cod':    '超商取貨付款',
  // legacy mappings kept so old orders still display
  transfer:     '銀行轉帳',
  card:         '信用卡',
  'card-mock':  '信用卡',
  cod:          '貨到付款',
};

const TAB_TO_STATUSES = {
  all:        null,
  pending:    ['awaiting_payment', 'paid', 'processing'],
  shipped:    ['shipped'],
  in_transit: ['in_transit'],
  delivered:  ['delivered'],
  refund:     ['refund_requested', 'refunded'],
};

const TYPE_TO_PAYMENTS = {
  all:      null,
  transfer: ['transfer'],
  card:     ['card', 'card-mock'],
  ecpay:    ['ecpay'],
  cod:      ['cod'],
};

async function openOrdersDashboard() {
  const token = getToken();
  if (!token) { showToast('請先登入'); return; }
  try {
    const res = await fetch('/api/auth/orders', { headers: { 'Authorization': `Bearer ${token}` } });
    ordersState.raw = res.ok ? await res.json() : [];
  } catch { ordersState.raw = []; }
  ordersState.tab = 'all'; ordersState.type = 'all'; ordersState.days = 'all'; ordersState.q = ''; ordersState.page = 1;
  document.querySelectorAll('#ordersTabs .ot-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === 'all'));
  document.getElementById('orderTypeFilter').value = 'all';
  document.getElementById('orderDateFilter').value = 'all';
  document.getElementById('orderSearch').value = '';
  renderOrdersDashboard();
  document.getElementById('ordersModal').classList.add('show');
}

function filterOrders() {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const statuses = TAB_TO_STATUSES[ordersState.tab];
  const payments = TYPE_TO_PAYMENTS[ordersState.type];
  const dayCut = ordersState.days === 'all' ? null : Number(ordersState.days);

  return ordersState.raw.filter(o => {
    if (statuses && !statuses.includes(o.status)) return false;
    if (payments && !payments.includes(o.payment?.method)) return false;
    if (dayCut && now - Date.parse(o.createdAt) > dayCut * dayMs) return false;
    if (ordersState.q) {
      const hay = (o.id + ' ' + (o.items || []).map(i => i.name).join(' ')).toLowerCase();
      if (!hay.includes(ordersState.q)) return false;
    }
    return true;
  });
}

function fmtDate(iso) {
  const d = new Date(iso);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function shippingLabel(o) {
  // Prefer the structured field set on new orders; fall back to address-string heuristic for legacy orders
  if (o.shipping?.method === 'cvs') {
    return `超商 - ${o.shipping.cvsBrand || ''} 取貨`.trim();
  }
  if (o.shipping?.method === 'address') return '宅配 - 黑貓宅急便';
  const addr = o.customer?.address || '';
  if (/7-?11|超商|統一|全家|萊爾富|ok|OK/.test(addr)) return '超商取貨';
  return '宅配 - 黑貓宅急便';
}

function renderOrdersDashboard() {
  const filtered = filterOrders();
  const totalPages = Math.max(1, Math.ceil(filtered.length / ordersState.pageSize));
  if (ordersState.page > totalPages) ordersState.page = totalPages;
  const start = (ordersState.page - 1) * ordersState.pageSize;
  const pageItems = filtered.slice(start, start + ordersState.pageSize);

  const el = document.getElementById('ordersTable');
  if (!pageItems.length) {
    el.innerHTML = '<div class="orders-empty">沒有符合條件的訂單</div>';
  } else {
    el.innerHTML = pageItems.map(o => {
      const status = STATUS_MAP[o.status] || { label: o.status || '—', cls: 'status-pending' };
      const qty = (o.items || []).reduce((s, x) => s + (x.qty || 0), 0);
      const pay = PAYMENT_LABEL[o.payment?.method] || (o.payment?.method || '—');
      const canRefund = ['paid', 'shipped', 'in_transit', 'delivered'].includes(o.status);
      const canConfirm = ['shipped', 'in_transit'].includes(o.status);
      return `
      <div class="order-card" data-id="${o.id}">
        <div class="oc-grid oc-head">
          <div>現銷訂單</div><div>日期</div><div>數量</div><div>金額</div>
          <div>配送區域</div><div>支付方式</div><div>狀態</div>
        </div>
        <div class="oc-grid oc-body">
          <div data-label="訂單編號" class="oc-id">${o.id}</div>
          <div data-label="日期">${fmtDate(o.createdAt)}</div>
          <div data-label="數量">${qty}</div>
          <div data-label="金額">NT$ ${(o.total || 0).toLocaleString()}</div>
          <div data-label="配送">${shippingLabel(o)}</div>
          <div data-label="付款">${pay}</div>
          <div data-label="狀態" class="oc-status ${status.cls}">${status.label}</div>
        </div>
        <div class="oc-actions">
          <a class="oc-detail-toggle" data-toggle="${o.id}">+ 看明細</a>
          <div class="oc-buttons">
            ${canConfirm ? `<button class="btn-light" data-confirm="${o.id}">確認收貨</button>` : ''}
            ${canRefund  ? `<button class="btn-light" data-refund="${o.id}">退貨</button>` : ''}
            <button data-detail="${o.id}">訂單詳情</button>
          </div>
        </div>
        <div class="order-items-expanded" id="exp-${o.id}" hidden>
          ${(o.items || []).map(it => `
            <div class="oi-row">
              <img src="${it.image}" alt="${it.name}">
              <div class="oi-info">
                <div>${it.name}</div>
                <small>尺寸：${it.size} ｜ 顏色：${it.color || '—'} ｜ 數量：${it.qty}</small>
              </div>
              <div class="oi-sub">NT$ ${(it.subtotal || 0).toLocaleString()}</div>
            </div>`).join('')}
        </div>
      </div>`;
    }).join('');

    // bind row actions
    el.querySelectorAll('[data-toggle]').forEach(a => a.addEventListener('click', (e) => {
      e.preventDefault();
      const id = a.dataset.toggle;
      const exp = document.getElementById('exp-' + id);
      const open = !exp.hasAttribute('hidden');
      if (open) { exp.setAttribute('hidden', ''); a.textContent = '+ 看明細'; }
      else      { exp.removeAttribute('hidden');   a.textContent = '− 收合明細'; }
    }));
    el.querySelectorAll('[data-detail]').forEach(b => b.addEventListener('click', () => openOrderDetail(b.dataset.detail)));
    el.querySelectorAll('[data-refund]').forEach(b => b.addEventListener('click', () => requestRefund(b.dataset.refund)));
    el.querySelectorAll('[data-confirm]').forEach(b => b.addEventListener('click', () => confirmReceipt(b.dataset.confirm)));
  }

  // pagination
  const pg = document.getElementById('ordersPagination');
  if (totalPages <= 1) { pg.innerHTML = ''; }
  else {
    let html = `<button ${ordersState.page === 1 ? 'disabled' : ''} data-pg="prev">‹</button>`;
    for (let i = 1; i <= totalPages; i++) {
      html += `<button class="${i === ordersState.page ? 'active' : ''}" data-pg="${i}">${i}</button>`;
    }
    html += `<button ${ordersState.page === totalPages ? 'disabled' : ''} data-pg="next">›</button>`;
    pg.innerHTML = html;
    pg.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      const v = b.dataset.pg;
      if (v === 'prev') ordersState.page--;
      else if (v === 'next') ordersState.page++;
      else ordersState.page = Number(v);
      renderOrdersDashboard();
    }));
  }
}

function openOrderDetail(id) {
  const o = ordersState.raw.find(x => x.id === id);
  if (!o) return;
  const status = STATUS_MAP[o.status] || { label: o.status, cls: '' };
  const pay = PAYMENT_LABEL[o.payment?.method] || (o.payment?.method || '—');
  const tracking = o.trackingNo ? `<p style="font-size:13px;margin:6px 0"><strong>物流單號：</strong>${o.trackingNo}</p>` : '';
  // Legacy transferBox kept for older orders; new orders no longer use bank transfer
  const transferBox = o.payment?.method === 'transfer' ? `
    <div style="background:#fff8ef;border:1px solid var(--accent);padding:14px 16px;border-radius:6px;margin-bottom:16px">
      <p style="font-size:13px;font-weight:600;margin-bottom:8px">🏦 匯款資訊（舊訂單）</p>
      ${o.payment?.transferLast5 ? `<p style="font-size:12px;color:#666;margin-top:8px">回填末5碼：<strong>${o.payment.transferLast5}</strong> ｜ 金額：<strong>NT$${(o.payment.transferAmount||0).toLocaleString()}</strong></p>` : ''}
    </div>` : '';
  document.getElementById('orderDetailBody').innerHTML = `
    <div style="background:var(--bg);border:1px solid var(--border);padding:16px 18px;border-radius:6px;margin-bottom:16px">
      <p style="font-size:13px;margin-bottom:6px"><strong>訂單編號：</strong>${o.id}</p>
      <p style="font-size:13px;margin:6px 0"><strong>建立時間：</strong>${fmtDate(o.createdAt)}</p>
      <p style="font-size:13px;margin:6px 0"><strong>狀態：</strong><span class="${status.cls}">${status.label}</span></p>
      <p style="font-size:13px;margin:6px 0"><strong>付款方式：</strong>${pay}</p>
      ${tracking}
    </div>
    ${transferBox}
    ${o.purchaser && (o.purchaser.name !== o.customer?.name || o.purchaser.phone !== o.customer?.phone) ? `
    <div style="background:#fff;border:1px solid var(--border);padding:16px 18px;border-radius:6px;margin-bottom:16px">
      <p style="font-size:13px;margin-bottom:8px;letter-spacing:1px"><strong>訂購人</strong></p>
      <p style="font-size:13px;color:#555;margin:4px 0">${o.purchaser.name} ／ ${o.purchaser.phone}</p>
      ${o.purchaser.email ? `<p style="font-size:13px;color:#555;margin:4px 0">${o.purchaser.email}</p>` : ''}
    </div>` : ''}
    <div style="background:#fff;border:1px solid var(--border);padding:16px 18px;border-radius:6px;margin-bottom:16px">
      <p style="font-size:13px;margin-bottom:8px;letter-spacing:1px"><strong>收件資訊</strong></p>
      <p style="font-size:13px;color:#555;margin:4px 0">${o.customer?.name || ''} ／ ${o.customer?.phone || ''}</p>
      <p style="font-size:13px;color:#555;margin:4px 0">${o.customer?.address || ''}</p>
      ${o.customer?.email ? `<p style="font-size:13px;color:#555;margin:4px 0">${o.customer.email}</p>` : ''}
    </div>
    <div style="border:1px solid var(--border);border-radius:6px;padding:14px 18px">
      <p style="font-size:13px;margin-bottom:10px;letter-spacing:1px"><strong>商品明細</strong></p>
      ${(o.items || []).map(it => `
        <div style="display:flex;gap:12px;padding:8px 0;border-bottom:1px solid #eee;align-items:center">
          <img src="${it.image}" style="width:54px;height:54px;object-fit:cover;border-radius:4px">
          <div style="flex:1;font-size:13px;line-height:1.6">
            <div>${it.name}</div>
            <small style="color:#999">尺寸：${it.size} ｜ 顏色：${it.color || '—'} ｜ 數量：${it.qty}</small>
          </div>
          <div style="font-weight:600;color:var(--accent)">NT$ ${(it.subtotal || 0).toLocaleString()}</div>
        </div>`).join('')}
      <div style="display:flex;justify-content:space-between;margin-top:12px;font-size:13px;color:#666"><span>商品小計</span><span>NT$ ${(o.subtotal || 0).toLocaleString()}</span></div>
      <div style="display:flex;justify-content:space-between;margin-top:4px;font-size:13px;color:#666"><span>運費</span><span>NT$ ${(o.shipping || 0).toLocaleString()}</span></div>
      <div style="display:flex;justify-content:space-between;margin-top:8px;font-size:15px;font-weight:600"><span>總計</span><span style="color:var(--accent)">NT$ ${(o.total || 0).toLocaleString()}</span></div>
    </div>`;
  document.getElementById('orderDetailModal').classList.add('show');
}

async function requestRefund(id) {
  const reason = prompt('請說明退貨原因（選填）') || '';
  if (reason === null) return;
  try {
    const res = await fetch(`/api/auth/orders/${id}/refund`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ reason }),
    });
    const data = await res.json();
    if (!res.ok) { showToast(data.error || '申請失敗'); return; }
    const idx = ordersState.raw.findIndex(o => o.id === id);
    if (idx !== -1) ordersState.raw[idx] = data.order;
    renderOrdersDashboard();
    showToast('已送出退貨申請');
  } catch { showToast('連線錯誤'); }
}

async function confirmReceipt(id) {
  if (!confirm('確認已收到貨品？')) return;
  try {
    const res = await fetch(`/api/auth/orders/${id}/confirm`, {
      method: 'POST',
      headers: authHeaders(),
    });
    const data = await res.json();
    if (!res.ok) { showToast(data.error || '操作失敗'); return; }
    const idx = ordersState.raw.findIndex(o => o.id === id);
    if (idx !== -1) ordersState.raw[idx] = data.order;
    renderOrdersDashboard();
    showToast('感謝您的確認');
  } catch { showToast('連線錯誤'); }
}

// ===== CVS MAP PICKER (iframe overlay — works without popup permission) =====
function openCvsPicker(brand) {
  const overlay = document.getElementById('cvsMapOverlay');
  const frame = document.getElementById('cvsMapFrame');
  document.getElementById('cvsMapTitle').textContent = `選擇 ${brand} 門市`;
  frame.src = `/api/cvs/map?brand=${encodeURIComponent(brand)}`;
  overlay.style.display = 'block';
  document.body.style.overflow = 'hidden'; // lock background scroll
}

function closeCvsPicker() {
  const overlay = document.getElementById('cvsMapOverlay');
  overlay.style.display = 'none';
  document.getElementById('cvsMapFrame').src = 'about:blank';
  document.body.style.overflow = '';
}

function applyCvsSelection(d) {
  if (!d || !d.storeName) return;
  document.getElementById('cvsBrand').value = d.brand || '';
  document.getElementById('cvsStore').value = d.storeName || '';
  document.getElementById('cvsStoreId').value = d.storeId || '';
  document.getElementById('cvsStoreAddress').value = d.address || '';

  document.getElementById('cvsSelBrand').textContent = d.brand || '';
  document.getElementById('cvsSelName').textContent = `${d.storeName}${d.storeId ? ` #${d.storeId}` : ''}`;
  document.getElementById('cvsSelAddr').textContent = d.address || '';
  document.getElementById('cvsSelected').style.display = 'block';
  showToast(`✓ 已選擇 ${d.brand} ${d.storeName}`);
}

function clearCvsSelection() {
  ['cvsBrand', 'cvsStore', 'cvsStoreId', 'cvsStoreAddress'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('cvsSelected').style.display = 'none';
}

// ===== SHIPPING / PAYMENT / RECIPIENT UI =====
// Shipping method drives address vs CVS block + which payment options are shown.
// Payment is independently chosen (信用卡 vs 超商取貨付款).
function currentCvsBrand() {
  const v = document.querySelector('input[name="shippingMethod"]:checked')?.value;
  if (v === 'cvs-711') return '7-11';
  if (v === 'cvs-fami') return '全家';
  return null;
}

function syncShippingMethodUI() {
  const brand = currentCvsBrand();
  const isCvs = !!brand;

  document.querySelector('.ship-block-address').style.display = isCvs ? 'none' : 'block';
  document.querySelector('.ship-block-cvs').style.display = isCvs ? 'block' : 'none';
  document.getElementById('buyerAddress').required = !isCvs;

  // 超商取貨付款 only visible when shipping = CVS
  const cvsCodLabel = document.getElementById('payCvsCodLabel');
  if (cvsCodLabel) cvsCodLabel.style.display = isCvs ? 'flex' : 'none';

  // If user previously picked 超商取貨付款 and switched back to 宅配 → reset to 信用卡
  if (!isCvs) {
    const cvsCodRadio = document.querySelector('input[name="paymentMethod"][value="cvs-cod"]');
    if (cvsCodRadio?.checked) {
      const ecpayRadio = document.querySelector('input[name="paymentMethod"][value="ecpay"]');
      if (ecpayRadio) ecpayRadio.checked = true;
      syncPaymentMethodUI();
    }
  }

  if (isCvs) {
    // Update CVS picker button color + label per brand
    const btn = document.getElementById('pickStoreBtn');
    const lbl = document.getElementById('pickStoreLabel');
    if (brand === '7-11') {
      btn.style.borderColor = '#e63946';
      btn.style.color = '#e63946';
      lbl.textContent = '🟧 點擊選擇 7-ELEVEN 門市';
    } else {
      btn.style.borderColor = '#00a651';
      btn.style.color = '#00a651';
      lbl.textContent = '🟩 點擊選擇 全家 門市';
    }
    // Clear store if user switched between 7-11 ↔ 全家
    const pickedBrand = document.getElementById('cvsBrand').value;
    if (pickedBrand && pickedBrand !== brand) clearCvsSelection();
  }

  // 運費依取貨方式即時重算
  if (document.getElementById('checkoutSummary')?.style.display === 'block') {
    updateCheckoutSummary();
  }
}

function syncPaymentMethodUI() {
  // Visual active state only — no side effects
  document.querySelectorAll('.pay-method').forEach(lbl => {
    const r = lbl.querySelector('input');
    if (r.checked) {
      lbl.style.borderColor = 'var(--accent)';
      lbl.style.background = 'var(--bg)';
    } else {
      lbl.style.borderColor = 'var(--border)';
      lbl.style.background = '#fff';
    }
  });
}

function syncRecipientUI() {
  const same = document.getElementById('sameAsPurchaser').checked;
  document.getElementById('recipientFields').style.display = same ? 'none' : 'block';
  if (same) mirrorPurchaserToRecipient();
}

function mirrorPurchaserToRecipient() {
  document.getElementById('rcpName').value  = document.getElementById('buyerName').value;
  document.getElementById('rcpPhone').value = document.getElementById('buyerPhone').value;
}

// ===== COUPONS / CHECKOUT SUMMARY =====
function populateCouponSelect() {
  const sel = document.getElementById('couponSelect');
  const group = document.getElementById('couponGroup');
  const available = (currentCustomer?.coupons || []).filter(c => !c.usedAt);
  if (!available.length) {
    group.style.display = 'none';
    sel.innerHTML = '<option value="">不使用折價券</option>';
    return;
  }
  group.style.display = 'block';
  sel.innerHTML = '<option value="">不使用折價券</option>' +
    available.map(c => `<option value="${c.id}">NT$${c.amount} ${c.reason || c.code}</option>`).join('');
}

function getCheckoutSummary() {
  // Pull totals from current cart state
  const subtotal = cart.reduce((s, x) => s + (x.subtotal || 0), 0);
  // 免運門檻依取貨方式：超商 2000、宅配 3000
  const uiShip = document.querySelector('input[name="shippingMethod"]:checked')?.value || 'address';
  const isCvs = uiShip === 'cvs-711' || uiShip === 'cvs-fami';
  const freeThreshold = isCvs ? 2000 : 3000;
  const shipping = subtotal === 0 ? 0 : (subtotal >= freeThreshold ? 0 : 80);
  const couponId = document.getElementById('couponSelect')?.value;
  const coupon = couponId ? (currentCustomer?.coupons || []).find(c => c.id === couponId) : null;
  const discount = coupon ? Math.min(coupon.amount, subtotal) : 0;
  const total = Math.max(0, subtotal + shipping - discount);
  return { subtotal, shipping, discount, total, coupon, freeThreshold, isCvs };
}

function updateCheckoutSummary() {
  const s = getCheckoutSummary();
  const box = document.getElementById('checkoutSummary');
  if (!box) return;
  box.style.display = 'block';
  document.getElementById('csSubtotal').textContent = `NT$${s.subtotal.toLocaleString()}`;

  // 運費顯示：免運就顯示「免運 ✨」；還沒到門檻就顯示「NT$80（再 NT$X 免運）」
  const shipEl = document.getElementById('csShipping');
  if (s.shipping === 0) {
    shipEl.textContent = '免運 ✨';
    shipEl.style.color = 'var(--accent)';
  } else {
    const gap = s.freeThreshold - s.subtotal;
    shipEl.innerHTML = `NT$${s.shipping} <span style="font-size:11px;color:#999">再 NT$${gap.toLocaleString()} ${s.isCvs ? '超商' : '宅配'}免運</span>`;
    shipEl.style.color = '';
  }

  const line = document.getElementById('csCouponLine');
  if (s.discount > 0) {
    line.style.display = 'flex';
    document.getElementById('csCouponLabel').textContent = `折價券 ${s.coupon?.reason || ''}`;
    document.getElementById('csCouponAmount').textContent = `−NT$${s.discount.toLocaleString()}`;
  } else {
    line.style.display = 'none';
  }
  document.getElementById('csTotal').textContent = `NT$${s.total.toLocaleString()}`;
}

// ===== START =====
document.addEventListener('DOMContentLoaded', init);
