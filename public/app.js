let products = [];
let cart = [];
let wishlist = new Set(JSON.parse(localStorage.getItem('yebuda_wishlist')) || []);

const lookbookImages = [
  { img:'images/LINE_ALBUM_2026424_260507_14.jpg', title:'Autumn Mood', sub:'秋日暖陽穿搭' },
  { img:'images/LINE_ALBUM_2026424_260507_16.jpg', title:'City Walk', sub:'城市漫步風格' },
  { img:'images/LINE_ALBUM_2026424_260507_17.jpg', title:'Weekend Vibes', sub:'週末悠閒時光' },
  { img:'images/LINE_ALBUM_2026424_260507_18.jpg', title:'Café Date', sub:'咖啡廳約會穿搭' }
];

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
  await loadCart();
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
function renderLookbook() {
  document.getElementById('lookbookGrid').innerHTML = lookbookImages.map(l =>
    `<div class="lookbook-item"><img src="${l.img}" alt="${l.title}" loading="lazy"><div class="lookbook-label"><h4>${l.title}</h4><p>${l.sub}</p></div></div>`
  ).join('');
}

// ===== INSTAGRAM =====
function renderInsta() {
  document.getElementById('instaGrid').innerHTML = instaImages.map(img =>
    `<div class="insta-item"><img src="${img}" alt="Instagram" loading="lazy"></div>`
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
    tab.addEventListener('click', () => {
      document.querySelectorAll('.cat-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const cat = tab.dataset.cat;
      const filtered = cat === 'all' ? products.slice(0, 8) : products.filter(p => p.category === cat);
      renderProducts('productGrid', filtered);
      bindProductEvents();
    });
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

  // Modal
  document.getElementById('modalClose').addEventListener('click', () => document.getElementById('productModal').classList.remove('show'));
  document.getElementById('productModal').addEventListener('click', (e) => { if (e.target.id === 'productModal') document.getElementById('productModal').classList.remove('show'); });

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
    
    const payload = {
      name: document.getElementById('buyerName').value,
      phone: document.getElementById('buyerPhone').value,
      address: document.getElementById('buyerAddress').value,
      payment: document.getElementById('paymentMethod').value, // 'ecpay' | 'transfer'
      email: 'guest@example.com' // required by backend but not in our UI, so mock it
    };

    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const result = await res.json();
      
      if (!res.ok) throw new Error(result.error || 'Checkout failed');

      if (result.redirectHtml) {
        // ECPay HTML form submission
        document.body.insertAdjacentHTML('beforeend', result.redirectHtml);
        return;
      }

      showToast(`感謝 ${payload.name} 的訂購！訂單已建立 🎉`);
      await loadCart(); // will clear it visually since backend cleared it
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

  // Back to top
  const backTop = document.getElementById('backTop');
  window.addEventListener('scroll', () => { backTop.classList.toggle('show', window.scrollY > 500); });
  backTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

  // ESC key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.getElementById('searchOverlay').classList.remove('show');
      document.getElementById('productModal').classList.remove('show');
      document.getElementById('cartDrawer').classList.remove('open');
      document.getElementById('mobileMenu').classList.remove('open');
    }
  });
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
      const id = btn.dataset.wish;
      toggleWish(id, btn);
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
  document.getElementById('productModal').classList.add('show');
}

function toggleWish(id, el) {
  if (wishlist.has(id)) { wishlist.delete(id); el.textContent = '♡'; el.classList.remove('active'); showToast('已從收藏移除'); }
  else { wishlist.add(id); el.textContent = '❤️'; el.classList.add('active'); showToast('已加入收藏 ♡'); }
  localStorage.setItem('yebuda_wishlist', JSON.stringify([...wishlist]));
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
    document.getElementById('cartCount').textContent = '0';
    return;
  }
  el.innerHTML = cart.map((item, i) =>
    `<div class="cart-item">
      <img src="${item.image}" alt="${item.name}">
      <div class="cart-item-info">
        <h4>${item.name}</h4>
        <div class="ci-size">尺寸：${item.size} ｜ 數量：${item.qty}</div>
        <div class="ci-price">NT$${item.subtotal.toLocaleString()}</div>
      </div>
      <span class="cart-item-remove" data-id="${item.productId}" data-size="${item.size}" data-color="${item.color}">✕</span>
    </div>`
  ).join('');
  
  document.getElementById('cartTotal').textContent = `NT$${total.toLocaleString()}`;
  document.getElementById('cartCount').textContent = cart.reduce((s, c) => s + c.qty, 0);

  document.querySelectorAll('.cart-item-remove').forEach(btn => {
    btn.addEventListener('click', () => { 
      removeFromCart(btn.dataset.id, btn.dataset.size, btn.dataset.color); 
    });
  });
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

// ===== START =====
document.addEventListener('DOMContentLoaded', init);
