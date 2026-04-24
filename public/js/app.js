/* Shared helpers + header/footer + cart badge */

export const TWD = n => 'NT$' + Number(n).toLocaleString('en-US');
export const mediaUrl = (p) => {
  if (!p) return '';
  if (p.startsWith('/') || p.startsWith('http')) return p;
  return '/media/' + p;
};

export async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(err.error || 'Request failed');
  }
  return res.json();
}

export function toast(msg) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), 2200);
}

export async function refreshCartBadge() {
  try {
    const { count } = await api('/api/cart/count');
    document.querySelectorAll('[data-cart-count]').forEach(el => {
      el.textContent = count > 0 ? count : '';
    });
  } catch {}
}

const CATEGORIES = [
  { key: 'all',    label: 'ALL',    zh: '全部商品' },
  { key: 'outer',  label: 'OUTER',  zh: '外套・大衣' },
  { key: 'blouse', label: 'BLOUSE', zh: '襯衫・上衣' },
  { key: 'tee',    label: 'TEE',    zh: '針織・T恤' },
  { key: 'knit',   label: 'KNIT',   zh: '毛衣・開襟' },
  { key: 'dress',  label: 'DRESS',  zh: '洋裝・連身裙' },
  { key: 'pants',  label: 'PANTS',  zh: '褲裙' },
  { key: 'set',    label: 'SET',    zh: '套裝' }
];
export { CATEGORIES };

export function renderHeader(activeKey = '') {
  const host = document.getElementById('header-root');
  if (!host) return;
  host.innerHTML = `
    <div class="announce">
      <div class="announce-track">
        <span>✧ 新會員首購輸入 NEW100 折 NT$100</span>
        <span>✧ 單筆滿 NT$3,000 享免運</span>
        <span>✧ 正韓預購每週三結單 · 現貨 48hr 出貨</span>
        <span>✧ SEOUL KOREA · EST. 2022</span>
        <span>✧ 新會員首購輸入 NEW100 折 NT$100</span>
        <span>✧ 單筆滿 NT$3,000 享免運</span>
      </div>
    </div>
    <header class="site-header">
      <div class="header-inner">
        <div class="utility-left">
          <a href="/shop.html">Shop</a>
          <a href="#">Notice</a>
          <a href="#">Review</a>
          <a href="#">Q&amp;A</a>
        </div>
        <a href="/" class="brand">
          YEBUDA
          <small>SEOUL · EST. 2022</small>
        </a>
        <div class="utility-right">
          <a href="#">Login</a>
          <a href="#">Join</a>
          <a href="/cart.html" class="cart-link">Cart <span data-cart-count class="cart-count"></span></a>
        </div>
      </div>
      <nav class="main-nav">
        ${CATEGORIES.map(c => `
          <a href="/shop.html?cat=${c.key}"
             class="${activeKey === c.key ? 'active' : ''} ${c.key === 'outer' ? 'hot' : ''}">
            ${c.label}
          </a>`).join('')}
      </nav>
    </header>`;
}

export function renderFooter() {
  const host = document.getElementById('footer-root');
  if (!host) return;
  host.innerHTML = `
    <footer>
      <div class="foot-inner">
        <div>
          <div class="foot-brand">YEBUDA</div>
          <p>SEOUL KOREA · 精選東大門正韓選品與韓網代購。<br>
          每個女孩，都該為了自己，漂漂亮亮的。</p>
        </div>
        <div>
          <h5>Customer Care</h5>
          <ul>
            <li><a href="#">購物須知</a></li>
            <li><a href="#">運送方式</a></li>
            <li><a href="#">退換貨政策</a></li>
            <li><a href="#">尺寸對照</a></li>
          </ul>
        </div>
        <div>
          <h5>About</h5>
          <ul>
            <li><a href="#">品牌故事</a></li>
            <li><a href="#">穿搭靈感</a></li>
            <li><a href="#">預購公告</a></li>
            <li><a href="#">聯絡我們</a></li>
          </ul>
        </div>
        <div>
          <h5>Follow</h5>
          <ul>
            <li><a href="#">Instagram · @yebuda22</a></li>
            <li><a href="#">Threads · yebuda22</a></li>
            <li><a href="#">蝦皮商城</a></li>
            <li><a href="#">官方 LINE</a></li>
          </ul>
          <p style="font-size:12px;margin-top:12px;color:#8c8274;">客服時間<br>週一~週五 10:00 - 20:00</p>
        </div>
      </div>
      <div class="foot-bottom">
        <span>© 2026 YEBUDA Apparel Collection. Seoul, Korea.</span>
        <div class="pay">
          <span>VISA</span>
          <span>MASTER</span>
          <span>JCB</span>
          <span>ATM</span>
          <span>LINE PAY</span>
        </div>
      </div>
    </footer>`;
}

export function productCard(p) {
  const off = p.originalPrice
    ? Math.round((1 - p.price / p.originalPrice) * 100)
    : 0;
  return `
    <article class="product-card">
      <a href="/product.html?id=${p.id}" class="thumb">
        ${p.badge ? `<span class="badge ${p.badge}">${p.badge}</span>` : ''}
        <span class="wish" title="加入收藏">♡</span>
        <img src="${mediaUrl(p.image)}" alt="${p.name}" loading="lazy">
        <span class="quick-add">查看商品</span>
      </a>
      <div class="info">
        <div class="sub">${p.subtitle}</div>
        <a href="/product.html?id=${p.id}"><div class="name">${p.name}</div></a>
        <div class="price">
          <span class="now">${TWD(p.price)}</span>
          ${p.originalPrice ? `<span class="was">${TWD(p.originalPrice)}</span><span class="off">-${off}%</span>` : ''}
        </div>
        <div class="colors">
          ${(p.colors || []).slice(0, 3).map(c => `<span>${c}</span>`).join('')}
          ${(p.colors || []).length > 3 ? `<span>+${p.colors.length - 3}</span>` : ''}
        </div>
      </div>
    </article>`;
}

document.addEventListener('DOMContentLoaded', () => {
  refreshCartBadge();
});
